"""會議與社員大會: convene meetings, notices (AI), check-in, voting, minutes (AI).

Same rules and back end as the website (/api/meetings): thresholds follow the
charter, ballots are anonymous (who voted is kept, not how), and the
attendance and vote counts refresh every few seconds while a meeting is open.
"""

from __future__ import annotations

import html
from datetime import date, timedelta

from PySide6.QtCore import QDate, Qt, QTime, QTimer
from PySide6.QtWidgets import (QApplication, QCheckBox, QComboBox, QDateEdit, QDialog, QFormLayout, QGroupBox,
                               QHBoxLayout, QHeaderView, QInputDialog, QLabel, QLineEdit, QListWidget,
                               QListWidgetItem, QMessageBox, QPlainTextEdit, QPushButton, QSpinBox, QSplitter,
                               QTableWidget, QTableWidgetItem, QTabWidget, QTextBrowser, QTimeEdit, QVBoxLayout,
                               QWidget)

from ..api import ApiError
from ..docx import Document
from ..i18n import raw, tr
from ..widgets import (DataTable, Page, background, busy, button_row, confirm, docx_path, export_info, icon_button,
                       open_html, open_url, save_docx, show_error)
from .admin import rich_text
from .members import dialog_buttons

STATUS_ACTIONS = {"draft": [("announced", "公告會議")], "announced": [("open", "開始開會"), ("draft", "退回籌備")],
                  "open": [("closed", "散會")], "closed": [("open", "重新開會")]}


def semester() -> str:
    today = date.today()
    year = today.year - 1911
    if today.month >= 8:
        return f"{year}-1"
    return f"{year - 1}-{1 if today.month == 1 else 2}"


TEMPLATES = {
    "期初社員大會": ("assembly", [
        ("report", "社長報告：本學期社務與活動規劃", "none"),
        ("report", "總務報告：本學期預算（章程第十一條第二款）", "none"),
        ("discussion", "本學期預算案", "ordinary"),
        ("discussion", "本學期社課與活動規劃案", "ordinary"),
    ]),
    "期末社員大會": ("assembly", [
        ("report", "社長報告：本學期社務成果", "none"),
        ("report", "總務報告：本學期決算（章程第十一條第二款）", "none"),
        ("report", "器材報告：財產清點與借用狀況", "none"),
        ("discussion", "本學期決算案", "ordinary"),
        ("election", "下屆幹部選舉／交接", "ordinary"),
    ]),
    "幹部會議": ("officers", [("report", "各組工作報告", "none"), ("discussion", "近期活動分工", "majority")]),
}


class MeetingDialog(QDialog):
    """Create or edit the details and agenda of a meeting."""

    def __init__(self, parent, options: dict, meeting: dict | None = None, template: str = ""):
        super().__init__(parent)
        self.options = options
        meeting = meeting or {}
        self.locked = meeting.get("status") in ("open", "closed")
        self.setWindowTitle(f"修改會議 - {raw(meeting.get('title', ''))}" if meeting else "召開新會議")
        self.setWindowFlag(Qt.WindowContextHelpButtonHint, False)
        self.type = QComboBox()
        for key, label in options.get("types", {}).items():
            self.type.addItem(label, key)
        self.title = QLineEdit(meeting.get("title", ""))
        self.date = QDateEdit()
        self.date.setCalendarPopup(True)
        self.date.setDisplayFormat("yyyy-MM-dd")
        self.date.setDate(QDate.fromString(meeting["date"], "yyyy-MM-dd") if meeting.get("date") else QDate.currentDate().addDays(7))
        self.time = QTimeEdit(QTime.fromString(meeting.get("time") or "19:00", "HH:mm"))
        self.time.setDisplayFormat("HH:mm")
        self.location = QLineEdit(meeting.get("location", ""))
        self.online = QLineEdit(meeting.get("onlineUrl", ""))
        self.online.setPlaceholderText("https://meet.google.com/...（可留空）")
        self.convener = QLineEdit(meeting.get("convener", ""))
        self.chair = QLineEdit(meeting.get("chair", ""))
        self.recorder = QLineEdit(meeting.get("recorder", ""))
        self.code = QLineEdit(meeting.get("checkInCode", ""))
        self.code.setPlaceholderText("4–12 位英數字，現場公布；開放學號簽到時開會會自動產生")
        self.guest = QCheckBox("開放沒有帳號的社員用「學號＋姓名」簽到投票（社員大會建議開啟）")
        self.guest.setChecked(meeting.get("guestAccess", True) if meeting else True)
        self.keywords = QPlainTextEdit(meeting.get("keywords", ""))
        self.keywords.setPlaceholderText("給 AI 寫開會通知的關鍵字與補充說明")
        self.keywords.setFixedHeight(54)
        index = self.type.findData(meeting.get("type", "assembly"))
        self.type.setCurrentIndex(max(index, 0))
        for widget in (self.type, self.date, self.time, self.location, self.online):
            widget.setEnabled(not self.locked)

        self.agenda = QTableWidget(0, 4)
        self.agenda.setHorizontalHeaderLabels(["類別", "案由", "說明", "表決門檻"])
        self.agenda.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.agenda.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        self.agenda.verticalHeader().setDefaultSectionSize(24)
        for item in meeting.get("agenda", []):
            self.add_item(item.get("kind"), item.get("title"), item.get("description"), item.get("threshold"), item.get("id"), item.get("amendmentId", ""))
        add = icon_button("新增議案", "add")
        add.clicked.connect(lambda: self.add_item())
        remove = icon_button("刪除議案", "delete")
        remove.clicked.connect(lambda: self.agenda.removeRow(self.agenda.currentRow()) if self.agenda.currentRow() >= 0 else None)
        up = QPushButton("上移")
        up.clicked.connect(lambda: self.move(-1))
        down = QPushButton("下移")
        down.clicked.connect(lambda: self.move(1))

        form = QFormLayout()
        form.addRow("會議類型：", self.type)
        form.addRow("會議名稱：", self.title)
        row = QHBoxLayout()
        row.addWidget(self.date)
        row.addWidget(self.time)
        row.addStretch(1)
        form.addRow("日期時間：", row)
        form.addRow("地點：", self.location)
        form.addRow("線上會議：", self.online)
        people = QHBoxLayout()
        for label, edit in (("召集人", self.convener), ("主席", self.chair), ("紀錄", self.recorder)):
            people.addWidget(QLabel(label + "："))
            people.addWidget(edit)
        form.addRow(people)
        form.addRow("簽到碼：", self.code)
        form.addRow("", self.guest)
        form.addRow("關鍵字：", self.keywords)
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(QLabel("議程（已開會時仍可新增臨時動議；已表決的議案不能刪除）："))
        layout.addWidget(self.agenda, 1)
        layout.addLayout(button_row(add, remove, up, down))
        layout.addWidget(dialog_buttons(self))
        self.resize(760, 640)
        if template and not meeting:
            kind, items = TEMPLATES[template]
            self.type.setCurrentIndex(max(self.type.findData(kind), 0))
            self.title.setText(f"{semester()} 學期{template}" if kind == "assembly" else template)
            for item_kind, title, threshold in items:
                self.add_item(item_kind, title, "", threshold)

    def add_item(self, kind="discussion", title="", description="", threshold="", item_id="", amendment_id="") -> None:
        row = self.agenda.rowCount()
        self.agenda.insertRow(row)
        kinds = QComboBox()
        for key, label in self.options.get("kinds", {}).items():
            kinds.addItem(label, key)
        kinds.setCurrentIndex(max(kinds.findData(kind or "discussion"), 0))
        thresholds = QComboBox()
        for key, label in self.options.get("thresholds", {}).items():
            thresholds.addItem(label.split("（")[0], key)
            thresholds.setItemData(thresholds.count() - 1, label, Qt.ToolTipRole)
        thresholds.setCurrentIndex(max(thresholds.findData(threshold or ("none" if kind == "report" else "ordinary")), 0))
        self.agenda.setCellWidget(row, 0, kinds)
        title_item = QTableWidgetItem(title or "")
        title_item.setData(Qt.UserRole, {"id": item_id or "", "amendmentId": amendment_id or ""})
        self.agenda.setItem(row, 1, title_item)
        self.agenda.setItem(row, 2, QTableWidgetItem(description or ""))
        self.agenda.setCellWidget(row, 3, thresholds)

    def move(self, step: int) -> None:
        row = self.agenda.currentRow()
        items = self.agenda_values()
        target = row + step
        if row < 0 or not 0 <= target < len(items):
            return
        items[row], items[target] = items[target], items[row]
        self.agenda.setRowCount(0)
        for item in items:
            self.add_item(item["kind"], item["title"], item["description"], item["threshold"], item.get("id"), item.get("amendmentId"))
        self.agenda.setCurrentCell(target, 1)

    def agenda_values(self) -> list:
        values = []
        for row in range(self.agenda.rowCount()):
            meta = self.agenda.item(row, 1).data(Qt.UserRole) or {}
            values.append({"kind": self.agenda.cellWidget(row, 0).currentData(), "title": self.agenda.item(row, 1).text().strip(),
                           "description": (self.agenda.item(row, 2).text() if self.agenda.item(row, 2) else "").strip(),
                           "threshold": self.agenda.cellWidget(row, 3).currentData(),
                           **({"id": meta["id"]} if meta.get("id") else {}), **({"amendmentId": meta["amendmentId"]} if meta.get("amendmentId") else {})})
        return values

    def accept(self) -> None:
        if not self.title.text().strip():
            QMessageBox.warning(self, "資料不完整", "請填寫會議名稱。")
            return
        if any(not item["title"] for item in self.agenda_values()):
            QMessageBox.warning(self, "資料不完整", "每個議案都要填寫案由。")
            return
        super().accept()

    def values(self) -> dict:
        data = {"title": self.title.text().strip(), "convener": self.convener.text().strip(), "chair": self.chair.text().strip(),
                "recorder": self.recorder.text().strip(), "checkInCode": self.code.text().strip().upper(),
                "guestAccess": self.guest.isChecked(), "keywords": self.keywords.toPlainText().strip(), "agenda": self.agenda_values()}
        if not self.locked:
            data.update({"type": self.type.currentData(), "date": self.date.date().toString("yyyy-MM-dd"),
                         "time": self.time.time().toString("HH:mm"), "location": self.location.text().strip(),
                         "onlineUrl": self.online.text().strip()})
        return data


class MeetingWindow(QDialog):
    """Everything about one meeting: notice, check-in, agenda and voting, minutes."""

    def __init__(self, page: "MeetingsPage", meeting_id: str):
        super().__init__(page)
        self.page = page
        self.api = page.api
        self.meeting_id = meeting_id
        self.meeting: dict = {}
        self.setWindowFlag(Qt.WindowMaximizeButtonHint, True)
        self.setWindowFlag(Qt.WindowContextHelpButtonHint, False)
        self.resize(1000, 700)
        self.officer = bool(page.me.get("officer"))

        self.header = QLabel()
        self.header.setTextFormat(Qt.RichText)  # its text is escaped HTML: never guess the format
        self.header.setObjectName("CaptionBar")
        self.summary = QLabel()
        self.summary.setTextFormat(Qt.RichText)
        self.summary.setWordWrap(True)
        self.summary.setTextInteractionFlags(Qt.TextSelectableByMouse | Qt.LinksAccessibleByMouse)
        self.summary.setOpenExternalLinks(True)
        self.tabs = QTabWidget()
        self.tabs.addTab(self.build_notice(), "開會通知")
        self.tabs.addTab(self.build_attendance(), "簽到")
        self.tabs.addTab(self.build_agenda(), "議程與表決")
        self.tabs.addTab(self.build_minutes(), "會議紀錄")

        self.status_buttons = QHBoxLayout()
        top = QHBoxLayout()
        top.addWidget(self.summary, 1)
        top.addLayout(self.status_buttons)
        layout = QVBoxLayout(self)
        layout.addWidget(self.header)
        layout.addLayout(top)
        layout.addWidget(self.tabs, 1)
        close = icon_button("關閉", "cross")
        close.clicked.connect(self.accept)
        layout.addLayout(button_row(close, stretch_first=True))

        # Live counts while the meeting is open.
        self.timer = QTimer(self)
        self.timer.setInterval(5000)
        self.timer.timeout.connect(self.poll)
        self.load()

    # ------------------------------------------------------------ building
    def build_notice(self) -> QWidget:
        widget = QWidget()
        layout = QVBoxLayout(widget)
        self.notice_title = QLineEdit()
        self.notice_title.setPlaceholderText("公告標題（AI 產生時會自動填入）")
        self.notice = QPlainTextEdit()
        self.notice.setPlaceholderText("開會通知內文（Markdown）。可按「AI 產生開會通知」依會議資料與關鍵字自動撰寫。")
        layout.addWidget(self.notice_title)
        layout.addWidget(self.notice, 1)
        self.ai_notice = icon_button("AI 產生開會通知", "ai")
        self.ai_notice.clicked.connect(self.draft_notice)
        save = icon_button("儲存通知", "save")
        save.clicked.connect(lambda: self.update_meeting({"notice": self.notice.toPlainText()}, "通知已儲存"))
        as_post = icon_button("發布成網站文章", "posts")
        as_post.clicked.connect(self.publish_post)
        as_announcement = icon_button("發布成社團公告", "notes", "所有社員登入時會收到通知；若社長啟用外部推播也會同步發送")
        as_announcement.clicked.connect(self.publish_announcement)
        link = icon_button("複製學號簽到連結", "copy", "沒有帳號的社員用這個網址簽到投票")
        link.clicked.connect(self.copy_guest_link)
        for button in (self.ai_notice, save, as_post, as_announcement):
            button.setEnabled(self.officer)
        layout.addLayout(button_row(self.ai_notice, save, as_post, as_announcement, link))
        return widget

    def build_attendance(self) -> QWidget:
        widget = QWidget()
        layout = QVBoxLayout(widget)
        self.quorum = QLabel()
        self.quorum.setObjectName("Total")
        layout.addWidget(self.quorum)
        mine = QGroupBox("我要簽到")
        row = QHBoxLayout(mine)
        self.my_code = QLineEdit()
        self.my_code.setPlaceholderText("現場公布的簽到碼")
        self.check_in = icon_button("簽到", "check")
        self.check_in.clicked.connect(self.sign_in)
        self.my_state = QLabel()
        row.addWidget(QLabel("簽到碼："))
        row.addWidget(self.my_code)
        row.addWidget(self.check_in)
        row.addWidget(self.my_state, 1)
        layout.addWidget(mine)
        self.attendance = DataTable([("姓名", "name"), ("表決權", lambda a: "有" if a.get("voting") else "無"),
                                     ("簽到時間", lambda a: (a.get("at") or "")[11:16]),
                                     ("方式", lambda a: {"self": "自行簽到", "guest": "學號簽到"}.get(a.get("by"), f"幹部登記（{a.get('by')}）")),
                                     ("IP", "ip")])
        layout.addWidget(self.attendance, 1)
        self.roster = QComboBox()
        self.roster.setEditable(True)
        self.roster.setInsertPolicy(QComboBox.NoInsert)
        add = icon_button("登記出席", "add")
        add.clicked.connect(self.add_attendee)
        remove = icon_button("移除簽到", "delete")
        remove.clicked.connect(self.remove_attendee)
        officer_row = QHBoxLayout()
        officer_row.addWidget(QLabel("幹部代為登記："))
        officer_row.addWidget(self.roster, 1)
        officer_row.addWidget(add)
        officer_row.addWidget(remove)
        holder = QWidget()
        holder.setLayout(officer_row)
        holder.setVisible(self.officer)
        layout.addWidget(holder)
        return widget

    def build_agenda(self) -> QWidget:
        splitter = QSplitter(Qt.Horizontal)
        self.items = QListWidget()
        self.items.currentRowChanged.connect(self.show_item)
        right = QWidget()
        layout = QVBoxLayout(right)
        self.item_info = QTextBrowser()
        self.item_info.setMaximumHeight(180)
        layout.addWidget(self.item_info)
        vote = QGroupBox("投票")
        vote_row = QHBoxLayout(vote)
        self.ballot_buttons = []
        for choice, label, name in (("agree", "同意", "check"), ("oppose", "反對", "cross"), ("abstain", "棄權", "about")):
            button = icon_button(label, name)
            button.clicked.connect(lambda _=False, c=choice: self.cast(c))
            vote_row.addWidget(button)
            self.ballot_buttons.append(button)
        self.vote_state = QLabel()
        vote_row.addWidget(self.vote_state, 1)
        layout.addWidget(vote)
        chair = QGroupBox("主席操作")
        chair_layout = QVBoxLayout(chair)
        row = QHBoxLayout()
        self.open_vote = icon_button("開始線上投票", "check")
        self.open_vote.clicked.connect(lambda: self.vote_action({"action": "open"}))
        self.close_vote = icon_button("結束投票並計票", "cross")
        self.close_vote.clicked.connect(lambda: self.vote_action({"action": "close"}))
        manual = icon_button("登錄現場票數...", "edit")
        manual.clicked.connect(self.manual_vote)
        for button in (self.open_vote, self.close_vote, manual):
            row.addWidget(button)
        row.addStretch(1)
        chair_layout.addLayout(row)
        self.item_notes = QPlainTextEdit()
        self.item_notes.setPlaceholderText("本案討論紀錄（關鍵字即可，散會後 AI 會整理成會議紀錄）")
        self.item_resolution = QLineEdit()
        self.item_resolution.setPlaceholderText("決議")
        save_notes = icon_button("儲存本案紀錄", "save")
        save_notes.clicked.connect(self.save_notes)
        chair_layout.addWidget(self.item_notes, 1)
        chair_layout.addWidget(self.item_resolution)
        chair_layout.addLayout(button_row(save_notes))
        chair.setVisible(self.officer)
        layout.addWidget(chair, 1)
        splitter.addWidget(self.items)
        splitter.addWidget(right)
        splitter.setSizes([280, 700])
        return splitter

    def build_minutes(self) -> QWidget:
        widget = QWidget()
        layout = QVBoxLayout(widget)
        self.minutes_state = QLabel()
        self.minutes_state.setTextFormat(Qt.RichText)
        layout.addWidget(self.minutes_state)
        self.minutes = QPlainTextEdit()
        self.minutes.setPlaceholderText("會議紀錄（Markdown）。散會後可按「AI 產生會議紀錄」依各案紀錄與表決結果撰寫。")
        layout.addWidget(self.minutes, 1)
        self.ai_minutes = icon_button("AI 產生會議紀錄", "ai")
        self.ai_minutes.clicked.connect(self.draft_minutes)
        self.save_minutes = icon_button("儲存草稿", "save")
        self.save_minutes.clicked.connect(lambda: self.minutes_action({"content": self.minutes.toPlainText()}, "已儲存草稿"))
        self.finalize = icon_button("定稿", "check")
        self.finalize.clicked.connect(self.finalize_minutes)
        self.unfinalize = icon_button("取消定稿（社長）", "cross")
        self.unfinalize.clicked.connect(lambda: self.minutes_action({"unfinalize": True}, "已取消定稿"))
        print_ = icon_button("列印／另存 PDF", "print")
        print_.clicked.connect(self.print_minutes)
        word = icon_button("匯出 Word...", "word", "會議資料、出席名單、各案表決結果與會議紀錄存成 Word 檔")
        word.clicked.connect(self.export_word)
        layout.addLayout(button_row(self.ai_minutes, self.save_minutes, self.finalize, self.unfinalize, print_, word))
        return widget

    # ------------------------------------------------------------- loading
    def load(self) -> None:
        try:
            with busy():
                self.meeting = self.api.get(f"/api/meetings/{self.meeting_id}")
        except ApiError as error:
            show_error(self, error)
            return
        self.render(full=True)

    def poll(self) -> None:
        def done(meeting):
            self.meeting = meeting
            self.render(full=False)
        background(lambda: self.api.get(f"/api/meetings/{self.meeting_id}"), done, lambda _error: None)

    def apply(self, meeting: dict, message: str = "") -> None:
        self.meeting = meeting
        self.render(full=True)
        self.page.replace(meeting)
        if message:
            self.page.status(message)

    def render(self, full: bool) -> None:
        m = self.meeting
        self.setWindowTitle(f"{raw(m.get('title', ''))} - 會議")
        self.header.setText(f"{raw(html.escape(m.get('title', '')))}　〔{raw(html.escape(m.get('typeLabel', '')))}"
                            f"・{raw(html.escape(m.get('statusLabel', '')))}〕")
        where = raw(html.escape(m.get("location") or "")) or "（地點待補）"
        if m.get("onlineUrl"):
            where += f'・<a href="{html.escape(m["onlineUrl"])}">線上會議</a>'
        code = f"・簽到碼 <b>{html.escape(m['checkInCode'])}</b>" if self.officer and m.get("checkInCode") else ""
        self.summary.setText(f"{m.get('date', '')} {m.get('time', '')}・{where}・召集人 {raw(html.escape(m.get('convener') or '—'))}{code}")
        while self.status_buttons.count():
            self.status_buttons.takeAt(0).widget().deleteLater()
        if self.officer:
            for status, label in STATUS_ACTIONS.get(m.get("status"), []):
                button = QPushButton(label)
                button.clicked.connect(lambda _=False, s=status: self.change_status(s))
                self.status_buttons.addWidget(button)
            edit = icon_button("修改會議...", "edit")
            edit.clicked.connect(self.edit)
            self.status_buttons.addWidget(edit)
        if m.get("status") == "open":
            self.timer.start()
        else:
            self.timer.stop()

        total = m.get("totalMembers")
        self.quorum.setText(f" 已簽到 {m.get('attendanceCount', 0)} 人，計入法定人數 {m.get('counted', 0)} 人"
                            + (f"，應出席（社員總額）{total} 人" if total is not None else "，開會時依名冊計算應出席人數") + " ")
        self.my_state.setText("✔ 您已簽到" + ("，具表決權" if m.get("canVote") else "（不具表決權）") if m.get("checkedIn") else "尚未簽到")
        self.check_in.setEnabled(not m.get("checkedIn") and m.get("status") in ("open", "announced"))
        self.my_code.setVisible(bool(m.get("requiresCode")))
        self.attendance.set_rows(m.get("attendance", []))

        current = self.items.currentRow()
        self.items.blockSignals(True)
        self.items.clear()
        for index, item in enumerate(m.get("agenda", [])):
            vote = item.get("vote", {})
            mark = "🗳 投票中" if vote.get("state") == "open" else ("✔ 通過" if (vote.get("result") or {}).get("passed") else "✘ 未通過" if vote.get("result") else "")
            entry = QListWidgetItem(f"第 {index + 1} 案　{item.get('title')}　{mark}")
            self.items.addItem(entry)
        self.items.blockSignals(False)
        if self.items.count():
            self.items.setCurrentRow(min(max(current, 0), self.items.count() - 1))
            self.show_item(self.items.currentRow(), keep_notes=not full)

        minutes = m.get("minutes", {})
        if full or not self.minutes.document().isModified():
            self.minutes.setPlainText(minutes.get("content", ""))
            self.minutes.document().setModified(False)
        final = bool(minutes.get("finalizedAt"))
        self.minutes_state.setText(f"已定稿（{minutes.get('finalizedAt', '')[:10]}，{raw(html.escape(minutes.get('finalizedBy', '')))}）" if final
                                   else "草稿" + (f"（最後修改：{raw(html.escape(minutes.get('updatedBy')))}）" if minutes.get("updatedBy") else ""))
        self.minutes.setReadOnly(final or not self.officer)
        for button in (self.ai_minutes, self.save_minutes, self.finalize):
            button.setEnabled(self.officer and not final)
        self.unfinalize.setEnabled(final and bool(self.page.me.get("president")))
        if full:
            self.notice.setPlainText(m.get("notice", ""))
            if not self.roster.count():
                for person in self.page.roster:
                    self.roster.addItem(f"{person.get('name') or '姓名待查'}（{person.get('studentId') or '無學號'}）{'' if person.get('voting') else '・無表決權'}", person["id"])

    def show_item(self, row: int, keep_notes: bool = False) -> None:
        agenda = self.meeting.get("agenda", [])
        if not 0 <= row < len(agenda):
            return
        item = agenda[row]
        vote = item.get("vote", {})
        result = vote.get("result")
        lines = [f"<b>{raw(html.escape(item.get('title', '')))}</b>（{raw(html.escape(self.page.options.get('kinds', {}).get(item.get('kind'), '')))}）",
                 raw(rich_text(item.get("description", ""))), f"表決門檻：{raw(html.escape(item.get('thresholdLabel', '')))}"]
        if result:
            lines.append(f"表決結果：同意 {vote.get('agree', 0)}、反對 {vote.get('oppose', 0)}、棄權 {vote.get('abstain', 0)}"
                         f"（{'線上' if vote.get('source') == 'online' else '現場'}）— <b>{raw(html.escape(result.get('reason', '')))}</b>")
        if item.get("resolution"):
            lines.append(f"決議：{raw(html.escape(item['resolution']))}")
        self.item_info.setHtml("<br>".join(line for line in lines if line))
        live = vote.get("state") == "open"
        self.vote_state.setText(f"投票中，已投 {vote.get('ballots', 0)} 票" + ("・您已投票" if item.get("voted") else "") if live
                                else ("此案不表決" if item.get("threshold") == "none" else "尚未開放投票" if not result else "投票已結束"))
        for button in self.ballot_buttons:
            button.setEnabled(live and not item.get("voted") and bool(self.meeting.get("canVote")))
        self.open_vote.setEnabled(self.meeting.get("status") == "open" and not live and item.get("threshold") != "none")
        self.close_vote.setEnabled(live)
        if not keep_notes:
            self.item_notes.setPlainText(item.get("notes", ""))
            self.item_resolution.setText(item.get("resolution", ""))

    def current_item(self) -> dict | None:
        row = self.items.currentRow()
        agenda = self.meeting.get("agenda", [])
        return agenda[row] if 0 <= row < len(agenda) else None

    # ------------------------------------------------------------- actions
    def call(self, work, message: str = "") -> bool:
        try:
            with busy():
                meeting = work()
        except ApiError as error:
            show_error(self, error)
            return False
        self.apply(meeting, message)
        return True

    def update_meeting(self, fields: dict, message: str) -> None:
        self.call(lambda: self.api.update_meeting(self.meeting_id, fields), message)

    def edit(self) -> None:
        dialog = MeetingDialog(self, self.page.options, self.meeting)
        if dialog.exec() == QDialog.Accepted:
            self.update_meeting(dialog.values(), "會議已更新")

    def change_status(self, status: str) -> None:
        data = {"status": status}
        if status == "open" and self.meeting.get("totalMembers") is None:
            total, ok = QInputDialog.getInt(self, "開始開會", "應出席人數（社員總額）。\n留 0 表示依社員名冊自動計算：", 0, 0, 5000)
            if not ok:
                return
            if total:
                data["totalMembers"] = total
        if status == "closed" and not confirm(self, "確定宣布散會？散會後不能再簽到與投票。"):
            return
        self.call(lambda: self.api.meeting_action(self.meeting_id, "status", data), "會議狀態已更新")

    def sign_in(self) -> None:
        self.call(lambda: self.api.meeting_action(self.meeting_id, "attendance", {"code": self.my_code.text().strip()}), "已簽到")

    def add_attendee(self) -> None:
        member_id = self.roster.currentData()
        if member_id:
            self.call(lambda: self.api.meeting_action(self.meeting_id, "attendance", {"memberId": member_id}), "已登記出席")

    def remove_attendee(self) -> None:
        row = self.attendance.current_row_data()
        if row and confirm(self, f"移除 {row.get('name')} 的簽到？"):
            self.call(lambda: self.api.meeting_action(self.meeting_id, "attendance", {"memberId": row["memberId"], "remove": True}), "已移除簽到")

    def cast(self, choice: str) -> None:
        item = self.current_item()
        label = {"agree": "同意", "oppose": "反對", "abstain": "棄權"}[choice]
        if item and confirm(self, f"確定對「{item['title']}」投下「{label}」？投票後不能更改，系統不會記錄您投了什麼。"):
            self.call(lambda: self.api.agenda_action(self.meeting_id, item["id"], "ballot", {"choice": choice}), "已投票")

    def vote_action(self, data: dict) -> None:
        item = self.current_item()
        if item:
            self.call(lambda: self.api.agenda_action(self.meeting_id, item["id"], "vote", data), "表決已更新")

    def manual_vote(self) -> None:
        item = self.current_item()
        if not item:
            return
        dialog = QDialog(self)
        dialog.setWindowTitle("登錄現場票數")
        boxes = {}
        form = QFormLayout(dialog)
        for key, label in (("agree", "同意"), ("oppose", "反對"), ("abstain", "棄權"), ("attendance", "出席人數")):
            box = QSpinBox()
            box.setRange(0, 5000)
            if key == "attendance":
                box.setValue(self.meeting.get("counted", 0))
            boxes[key] = box
            form.addRow(label + "：", box)
        form.addRow(dialog_buttons(dialog))
        if dialog.exec() == QDialog.Accepted:
            self.vote_action({"action": "manual", **{k: b.value() for k, b in boxes.items()}})

    def save_notes(self) -> None:
        item = self.current_item()
        if item:
            self.call(lambda: self.api.agenda_action(self.meeting_id, item["id"], "notes", {"notes": self.item_notes.toPlainText(), "resolution": self.item_resolution.text()}), "本案紀錄已儲存")

    def draft_notice(self) -> None:
        try:
            with busy():
                draft = self.api.meeting_action(self.meeting_id, "ai-notice", {"keywords": self.meeting.get("keywords", "")}, timeout=90)
        except ApiError as error:
            show_error(self, error)
            return
        self.notice_title.setText(draft.get("title", ""))
        self.notice.setPlainText(draft.get("content", ""))
        QMessageBox.information(self, "AI 開會通知", "已產生，請檢查後按「儲存通知」。")

    def notice_text(self) -> tuple[str, str] | None:
        content = self.notice.toPlainText().strip()
        if not content:
            QMessageBox.information(self, "開會通知", "請先產生或填寫通知。")
            return None
        return self.notice_title.text().strip() or f"{self.meeting.get('title')} 開會通知", content

    def publish_post(self) -> None:
        notice = self.notice_text()
        if not notice:
            return
        from .website import ContentEditor, slugify
        editor = ContentEditor(self, self.api, "post", None, False)
        editor.fill({"title": notice[0], "content": notice[1], "slug": f"meeting-{self.meeting.get('date', '')}-{slugify(self.meeting_id)[:8]}", "force_slug": True,
                     "summary": f"{self.meeting.get('date')} {self.meeting.get('time', '')} {self.meeting.get('location', '')}".strip()})
        editor.exec()

    def publish_announcement(self) -> None:
        notice = self.notice_text()
        if not notice or not confirm(self, "發布成社團公告？所有社員都會收到通知。"):
            return
        audience = "all" if self.meeting.get("type") in ("assembly", "extraordinary") else "officers"
        try:
            with busy():
                result = self.api.create_announcement({"title": notice[0], "content": notice[1], "audience": audience, "pinned": True})
        except ApiError as error:
            show_error(self, error)
            return
        pushed = "、".join(p["target"] for p in result.get("push", []) if p.get("result") == "sent")
        QMessageBox.information(self, "社團公告", "已發布公告" + (f"，並推播到 {pushed}" if pushed else "") + "。")

    def copy_guest_link(self) -> None:
        QApplication.clipboard().setText(f"{self.api.base_url}/meeting/{self.meeting_id}")
        self.page.status("學號簽到連結已複製")

    def minutes_action(self, data: dict, message: str) -> None:
        self.call(lambda: self.api.save_minutes(self.meeting_id, data), message)

    def draft_minutes(self) -> None:
        if self.minutes.toPlainText().strip() and not confirm(self, "會覆蓋目前的會議紀錄草稿，確定重新產生？"):
            return
        try:
            with busy():
                draft = self.api.meeting_action(self.meeting_id, "ai-minutes", {}, timeout=90)
                meeting = self.api.save_minutes(self.meeting_id, {"content": draft.get("content", ""), "generated": True})
        except ApiError as error:
            show_error(self, error)
            return
        self.apply(meeting, "已產生並儲存會議紀錄草稿")
        if draft.get("notes"):
            QMessageBox.information(self, "AI 會議紀錄", "AI 備註：" + draft["notes"])

    def finalize_minutes(self) -> None:
        if confirm(self, "定稿後就不能再修改（社長可以取消定稿）。確定定稿？"):
            self.minutes_action({"content": self.minutes.toPlainText(), "finalize": True}, "會議紀錄已定稿")

    def print_minutes(self) -> None:
        try:
            with busy():
                page = self.api.page_html(f"/admin/meetings/{self.meeting_id}/minutes")
        except ApiError as error:
            show_error(self, error)
            return
        open_html(self, page, f"minutes-{self.meeting_id}")

    def export_word(self) -> None:
        path = docx_path(self, f"{self.meeting.get('date', '')} {self.meeting.get('title', '會議')}.docx")
        if path:
            save_docx(self, meeting_document(self.meeting, self.page.options, self.page.user, self.api.base_url,
                                             self.minutes.toPlainText()), path)

    def done(self, result: int) -> None:  # noqa: D401 - Qt override
        self.timer.stop()
        super().done(result)


def meeting_document(m: dict, options: dict, user: dict, server: str, minutes: str = "") -> Document:
    """The whole meeting on paper: details, notice, attendance, agenda with vote results, minutes and signatures."""
    document = Document(m.get("title", ""))
    document.title_block(raw(m.get("title", "")), f"{raw(m.get('typeLabel', ''))}・{raw(m.get('statusLabel', ''))}・{export_info(user, server)}")
    total = m.get("totalMembers")
    document.table(["項目", "內容"], [
        ["日期時間", f"{m.get('date', '')} {m.get('time', '')}".strip()],
        ["地點", m.get("location") or "—"], ["線上會議", m.get("onlineUrl") or "—"],
        ["召集人／主席／紀錄", "／".join(x or "—" for x in (m.get("convener"), m.get("chair"), m.get("recorder")))],
        ["出席", tr(f"簽到 {m.get('attendanceCount', 0)} 人，計入法定人數 {m.get('counted', 0)} 人" + (f"，應出席 {total} 人" if total is not None else ""))],
    ], widths=[2400, 7200])
    if m.get("notice"):
        document.heading("開會通知", 1)
        document.markdown(m["notice"])
    document.heading("議程與表決結果", 1)
    kinds = options.get("kinds", {})
    for index, item in enumerate(m.get("agenda", []), 1):
        document.heading(f"第 {index} 案　{raw(item.get('title', ''))}（{raw(kinds.get(item.get('kind'), ''))}）", 2)
        if item.get("description"):
            document.paragraph(raw(item["description"]))
        document.paragraph(f"表決門檻：{raw(item.get('thresholdLabel', ''))}", size=18)
        vote, result = item.get("vote", {}), item.get("vote", {}).get("result")
        if result:
            document.paragraph(f"表決結果：同意 {vote.get('agree', 0)}、反對 {vote.get('oppose', 0)}、棄權 {vote.get('abstain', 0)}"
                               f"（{'線上投票' if vote.get('source') == 'online' else '現場表決'}）——**{raw(result.get('reason', ''))}**")
        if item.get("notes"):
            document.paragraph(f"討論紀錄：{raw(item['notes'])}")
        if item.get("resolution"):
            document.paragraph(f"**決議：**{raw(item['resolution'])}")
    attendance = m.get("attendance", [])
    if attendance:
        document.heading("出席名單", 1)
        document.table(["#", "姓名", "表決權", "簽到時間"],
                       [[str(i), a.get("name", ""), "有" if a.get("voting") else "無", (a.get("at") or "")[11:16]] for i, a in enumerate(attendance, 1)],
                       widths=[800, 4000, 1800, 3000])
    text = minutes or (m.get("minutes") or {}).get("content", "")
    if text.strip():
        document.page_break()
        document.heading("會議紀錄" + ("（已定稿）" if (m.get("minutes") or {}).get("finalizedAt") else "（草稿）"), 1)
        document.markdown(text)
    document.paragraph("")
    document.paragraph("主席簽名：＿＿＿＿＿＿＿＿　　　　紀錄簽名：＿＿＿＿＿＿＿＿", align="center")
    return document


class MeetingsPage(Page):
    title = "會議與社員大會"
    icon_name = "meetings"
    export_name = "會議.csv"

    def __init__(self, *args):
        super().__init__(*args)
        self.meetings: list[dict] = []
        self.me: dict = {}
        self.options: dict = {}
        self.roster: list[dict] = []
        self.body.addWidget(QLabel("線上公告開會通知、簽到、計算法定出席人數、無記名線上投票，並把各案關鍵字整理成會議紀錄。"
                                   "表決門檻依章程第十條、第九條、第十二條自動判定。"))
        self.table = DataTable([("日期", "date"), ("時間", "time"), ("會議名稱", "title"), ("類型", "typeLabel"), ("狀態", "statusLabel"),
                                ("出席", lambda m: f"{m.get('counted', 0)} / {m.get('totalMembers') if m.get('totalMembers') is not None else '—'}"),
                                ("會議紀錄", lambda m: "已定稿" if (m.get("minutes") or {}).get("finalizedAt") else ("草稿" if (m.get("minutes") or {}).get("content") else "")),
                                ("我", lambda m: "已簽到" if m.get("checkedIn") else "")])
        self.table.doubleClicked.connect(self.open_meeting)
        self.body.addWidget(self.table, 1)
        open_ = icon_button("開啟(&O)...", "preview")
        open_.clicked.connect(self.open_meeting)
        self.new = icon_button("召開新會議(&N)...", "add")
        self.new.clicked.connect(lambda: self.create(""))
        self.template = QComboBox()
        self.template.setSizeAdjustPolicy(QComboBox.AdjustToContents)
        self.template.addItem("用範本建立…", "")
        for name in TEMPLATES:
            self.template.addItem(name, name)
        self.template.activated.connect(lambda: self.create(self.template.currentData()) if self.template.currentData() else None)
        self.remove_button = icon_button("刪除", "delete")
        self.remove_button.clicked.connect(self.remove)
        row = button_row(open_, self.new, self.remove_button)
        row.insertWidget(2, self.template)
        self.body.addLayout(row)

    def refresh(self) -> None:
        data = self.api.meetings()
        self.meetings = data.get("meetings", [])
        self.me = data.get("me", {})
        self.options = data.get("options", {})
        self.roster = data.get("roster", [])
        officer = bool(self.me.get("officer"))
        for widget in (self.new, self.template, self.remove_button):
            widget.setVisible(officer)
        self.table.set_rows(self.meetings)
        live = [m for m in self.meetings if m.get("status") == "open"]
        self.status(f"會議 {len(self.meetings)} 場" + (f"，開會中：{live[0]['title']}" if live else ""))

    def replace(self, meeting: dict) -> None:
        for index, item in enumerate(self.meetings):
            if item["id"] == meeting["id"]:
                self.meetings[index] = meeting
        self.table.set_rows(self.meetings)

    def create(self, template: str) -> None:
        self.template.setCurrentIndex(0)
        dialog = MeetingDialog(self, self.options, None, template)
        if dialog.exec() != QDialog.Accepted:
            return
        try:
            with busy():
                meeting = self.api.create_meeting(dialog.values())
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()
        MeetingWindow(self, meeting["id"]).exec()

    def open_meeting(self) -> None:
        meeting = self.table.current_row_data()
        if not meeting:
            QMessageBox.information(self, self.title, "請先選取一場會議。")
            return
        MeetingWindow(self, meeting["id"]).exec()
        self.safe_refresh()

    def export_docx(self) -> None:
        """The selected meeting's full record; with nothing selected, the meeting list."""
        meeting = self.table.current_row_data()
        if not meeting:
            super().export_docx()
            return
        try:
            with busy():
                meeting = self.api.get(f"/api/meetings/{meeting['id']}")
        except ApiError as error:
            show_error(self, error)
            return
        path = docx_path(self, f"{meeting.get('date', '')} {meeting.get('title', '會議')}.docx")
        if path:
            save_docx(self, meeting_document(meeting, self.options, self.user, self.api.base_url), path)

    def remove(self) -> None:
        meeting = self.table.current_row_data()
        if not meeting or not confirm(self, f"確定刪除會議「{meeting['title']}」？"):
            return
        try:
            with busy():
                self.api.delete_meeting(meeting["id"])
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()
