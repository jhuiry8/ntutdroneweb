"""選舉管理 page: elections, candidates (選舉公報), voting status, audit log and results.

Voting itself happens on the website (/vote/<id>): the server identifies each
voter's device with a browser cookie, so ballots are not cast from this program.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from PySide6.QtCore import QDateTime, QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDateTimeEdit, QDialog, QFormLayout, QGroupBox,
                               QHBoxLayout, QLabel, QLineEdit, QMessageBox, QPlainTextEdit, QPushButton,
                               QSpinBox, QTabWidget, QVBoxLayout, QWidget)

from ..api import ApiError
from ..widgets import DataTable, Page, busy, button_row, confirm, show_error
from .members import dialog_buttons

STATUS_LABELS = {"draft": "草稿", "published": "已公告", "open": "投票中", "closed": "已結束"}
ELIGIBILITY = [("voting", "具表決權之社員"), ("roster", "社員名冊上所有人")]
EVENT_LABELS = {
    "verify-ok": "身分驗證通過", "verify-failed": "身分驗證失敗", "verify-already-voted": "重複投票嘗試",
    "verify-device-used": "裝置已投過票", "cast-device-mismatch": "換裝置投票被拒", "voted": "完成投票",
    "status:publish": "公告選舉", "status:unpublish": "撤回公告", "status:open": "開始投票",
    "status:close": "結束投票", "status:publish-results": "公布結果", "status:hide-results": "隱藏結果",
}
TAIPEI = timezone(timedelta(hours=8))
EMPTY_TIME = QDateTime(2000, 1, 1, 0, 0, 0)


def taipei_time(iso: str) -> str:
    """'2026-12-01T01:00:00.000Z' → '2026/12/01 09:00' (Taiwan time)."""
    if not iso:
        return ""
    try:
        moment = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return ""
    return moment.astimezone(TAIPEI).strftime("%Y/%m/%d %H:%M")


def local_input(iso: str) -> str:
    """ISO time → 'YYYY-MM-DDTHH:MM' in Taiwan time, the format the server accepts."""
    text = taipei_time(iso)
    return text.replace("/", "-").replace(" ", "T") if text else ""


def time_edit(iso: str) -> QDateTimeEdit:
    edit = QDateTimeEdit()
    edit.setDisplayFormat("yyyy/MM/dd HH:mm")
    edit.setCalendarPopup(True)
    edit.setMinimumDateTime(EMPTY_TIME)
    edit.setSpecialValueText("（未設定）")
    value = local_input(iso)
    edit.setDateTime(QDateTime.fromString(value, "yyyy-MM-ddTHH:mm") if value else EMPTY_TIME)
    return edit


def time_value(edit: QDateTimeEdit) -> str:
    return "" if edit.dateTime() == EMPTY_TIME else edit.dateTime().toString("yyyy-MM-ddTHH:mm")


class CandidateDialog(QDialog):
    def __init__(self, parent, candidate: dict | None, number: int):
        super().__init__(parent)
        c = candidate or {}
        self.candidate_id = c.get("id", "")
        self.setWindowTitle("修改候選人" if candidate else "新增候選人")
        self.number = QSpinBox()
        self.number.setRange(1, 99)
        self.number.setValue(int(c.get("number") or number))
        self.name = QLineEdit(c.get("name", ""))
        self.department = QLineEdit(c.get("department", ""))
        self.department.setPlaceholderText("例如 機械三")
        self.slogan = QLineEdit(c.get("slogan", ""))
        self.photo = QLineEdit(c.get("photoUrl", ""))
        self.photo.setPlaceholderText("https:// 開頭的公開圖片網址")
        self.experience = QPlainTextEdit(c.get("experience", ""))
        self.experience.setFixedHeight(70)
        self.platform = QPlainTextEdit(c.get("platform", ""))
        self.platform.setFixedHeight(130)
        form = QFormLayout()
        form.addRow("號次：", self.number)
        form.addRow("姓名：", self.name)
        form.addRow("系級：", self.department)
        form.addRow("競選標語：", self.slogan)
        form.addRow("照片網址：", self.photo)
        form.addRow("經歷：", self.experience)
        form.addRow("政見：", self.platform)
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(dialog_buttons(self))
        self.setMinimumWidth(460)

    def accept(self) -> None:
        if not self.name.text().strip():
            QMessageBox.warning(self, "資料不完整", "請填寫候選人姓名。")
            return
        photo = self.photo.text().strip()
        if photo and not photo.lower().startswith("https://"):
            QMessageBox.warning(self, "資料錯誤", "照片網址須為 https:// 開頭。")
            return
        super().accept()

    def values(self) -> dict:
        data = {"number": self.number.value(), "name": self.name.text().strip(),
                "department": self.department.text().strip(), "slogan": self.slogan.text().strip(),
                "photoUrl": self.photo.text().strip(), "experience": self.experience.toPlainText().strip(),
                "platform": self.platform.toPlainText().strip()}
        if self.candidate_id:
            data["id"] = self.candidate_id
        return data


class ElectionDialog(QDialog):
    def __init__(self, parent, election: dict | None = None):
        super().__init__(parent)
        e = election or {}
        self.setWindowTitle("編輯選舉" if election else "新增選舉")
        self.title = QLineEdit(e.get("title", ""))
        self.title.setPlaceholderText("例如 第 116 學年度社長選舉")
        self.position = QLineEdit(e.get("position", ""))
        self.starts = time_edit(e.get("startsAt", ""))
        self.ends = time_edit(e.get("endsAt", ""))
        self.eligibility = QComboBox()
        for key, label in ELIGIBILITY:
            self.eligibility.addItem(label, key)
        self.eligibility.setCurrentIndex(1 if e.get("eligibility") == "roster" else 0)
        self.one_device = QCheckBox("每台裝置只能投一票（防止拿他人學號姓名代投，建議開啟）")
        self.one_device.setChecked(e.get("oneVotePerDevice", True) is not False)
        self.description = QPlainTextEdit(e.get("description", ""))
        self.description.setFixedHeight(80)
        self.candidates = [dict(c) for c in e.get("candidates", [])]

        form = QFormLayout()
        form.addRow("選舉名稱：", self.title)
        form.addRow("選舉職位：", self.position)
        form.addRow("投票開始（臺灣時間）：", self.starts)
        form.addRow("投票截止（臺灣時間）：", self.ends)
        form.addRow("選舉人資格：", self.eligibility)
        form.addRow("", self.one_device)
        form.addRow("選舉說明：", self.description)

        box = QGroupBox("候選人（選舉公報）　只有一位候選人時，選票為「同意／不同意」")
        inner = QVBoxLayout(box)
        self.table = DataTable([("號次", "number", "right"), ("姓名", "name"), ("系級", "department"),
                                ("標語", "slogan"), ("政見", lambda c: (c.get("platform") or "").replace("\n", " ")[:60])])
        self.table.doubleClicked.connect(self.edit_candidate)
        inner.addWidget(self.table, 1)
        add = QPushButton("新增候選人(&A)...")
        add.clicked.connect(self.add_candidate)
        edit = QPushButton("修改(&E)...")
        edit.clicked.connect(self.edit_candidate)
        remove = QPushButton("移除(&R)")
        remove.clicked.connect(self.remove_candidate)
        inner.addLayout(button_row(add, edit, remove))

        hint = QLabel("時間可留空，由社長按「開始投票」「結束投票」控制。開始投票時會依當下社員名冊鎖定選舉人名冊，"
                      "之後不能再修改選舉內容與候選人。")
        hint.setWordWrap(True)
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(box, 1)
        layout.addWidget(hint)
        layout.addWidget(dialog_buttons(self))
        self.resize(640, 640)
        self.show_candidates()

    def show_candidates(self) -> None:
        self.candidates.sort(key=lambda c: c.get("number", 0))
        self.table.set_rows(self.candidates)

    def add_candidate(self) -> None:
        used = [c.get("number", 0) for c in self.candidates]
        dialog = CandidateDialog(self, None, (max(used) if used else 0) + 1)
        if dialog.exec() == QDialog.Accepted:
            self.candidates.append(dialog.values())
            self.show_candidates()

    def edit_candidate(self) -> None:
        row = self.table.current_row_data()
        if not row:
            return
        dialog = CandidateDialog(self, row, row.get("number", 1))
        if dialog.exec() == QDialog.Accepted:
            self.candidates[self.candidates.index(row)] = dialog.values()
            self.show_candidates()

    def remove_candidate(self) -> None:
        row = self.table.current_row_data()
        if row and confirm(self, f"移除候選人「{row.get('name')}」？"):
            self.candidates.remove(row)
            self.show_candidates()

    def accept(self) -> None:
        if not self.title.text().strip():
            QMessageBox.warning(self, "資料不完整", "請填寫選舉名稱。")
            return
        numbers = [c.get("number") for c in self.candidates]
        if len(numbers) != len(set(numbers)):
            QMessageBox.warning(self, "資料錯誤", "候選人號次重複。")
            return
        starts, ends = time_value(self.starts), time_value(self.ends)
        if starts and ends and ends <= starts:
            QMessageBox.warning(self, "資料錯誤", "投票截止時間須晚於開始時間。")
            return
        super().accept()

    def values(self) -> dict:
        return {"title": self.title.text().strip(), "position": self.position.text().strip(),
                "description": self.description.toPlainText(), "startsAt": time_value(self.starts),
                "endsAt": time_value(self.ends), "eligibility": self.eligibility.currentData(),
                "oneVotePerDevice": self.one_device.isChecked(), "candidates": self.candidates}


class AuditDialog(QDialog):
    """Who voted, when and from where (never what), plus warnings and the count."""

    def __init__(self, parent, election: dict, audit: dict, results: dict | None):
        super().__init__(parent)
        self.setWindowTitle(f"投票稽核 - {election.get('title', '')}")
        tabs = QTabWidget()
        if results:
            page = QWidget()
            box = QVBoxLayout(page)
            table = DataTable([("選項", "label"), ("得票", "votes", "right")])
            table.set_rows(results.get("options", []))
            box.addWidget(table, 1)
            same = results.get("totalBallots") == results.get("voters")
            box.addWidget(QLabel(f"選票 {results.get('totalBallots')} 張・投票紀錄 {results.get('voters')} 筆"
                                 f"（{'一致' if same else '數量不一致，請檢查'}）・選舉人 {results.get('rollSize')} 人・"
                                 f"投票率 {results.get('turnout', 0) * 100:.1f}%"))
            tabs.addTab(page, "開票結果")
        flags = audit.get("flags", [])
        flag_table = DataTable([("等級", lambda f: "危險" if f.get("level") == "danger" else "注意"),
                                ("說明", "message"), ("學號", lambda f: "、".join(f.get("studentIds", [])))])
        flag_table.set_rows(flags)
        tabs.addTab(flag_table, f"稽核提示（{len(flags)}）")
        self.voters = DataTable([
            ("投票時間", lambda v: taipei_time(v.get("votedAt", ""))), ("學號", "studentId"), ("姓名", "name"),
            ("IP", "ip"), ("網路", lambda v: "・".join(x for x in (v.get("network"), v.get("city"), v.get("country")) if x)),
            ("平台", "platform"), ("螢幕", "screen"), ("時區", "timezone"),
            ("裝置 ID", lambda v: (v.get("deviceId") or "")[:12]), ("裝置特徵", lambda v: (v.get("fingerprint") or "")[:12]),
            ("瀏覽器", "userAgent"),
        ])
        self.voters.set_rows(audit.get("voters", []))
        tabs.addTab(self.voters, f"投票紀錄（{len(audit.get('voters', []))} / {audit.get('rollSize', 0)}）")
        events = DataTable([("時間", lambda e: taipei_time(e.get("at", ""))),
                            ("事件", lambda e: EVENT_LABELS.get(e.get("type"), e.get("type", ""))),
                            ("學號／操作者", lambda e: e.get("studentId") or e.get("by", "")), ("IP", "ip"),
                            ("裝置 ID", lambda e: (e.get("deviceId") or "")[:12])])
        events.set_rows(audit.get("events", []))
        tabs.addTab(events, "選務事件")
        export = QPushButton("匯出投票紀錄 CSV...")
        export.clicked.connect(lambda: self.voters.export_csv(self, "投票紀錄.csv"))
        close = QPushButton("關閉")
        close.clicked.connect(self.accept)
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("投票紀錄只記錄誰在何時、從哪裡投票，不含投票內容；選票與身分分開保存。"))
        layout.addWidget(tabs, 1)
        layout.addLayout(button_row(export, close, stretch_first=True))
        self.resize(980, 560)


class ElectionsPage(Page):
    title = "選舉管理"
    export_name = "選舉列表.csv"

    def __init__(self, *args):
        super().__init__(*args)
        note = QLabel("登錄候選人與選舉公報、開始／結束投票、查看稽核紀錄與開票結果。開始、結束投票及公布結果限社長操作。"
                      "選民在網站的 /vote 頁面以學號與姓名投票。")
        note.setWordWrap(True)
        self.body.addWidget(note)
        self.table = DataTable([
            ("選舉", "title"), ("職位", "position"),
            ("狀態", lambda e: STATUS_LABELS.get(e.get("status"), "") + (
                ("（結果已公布）" if e.get("resultsPublic") else "（結果未公布）") if e.get("status") == "closed" else "")),
            ("候選人", lambda e: len(e.get("candidates", [])), "right"),
            ("已投票／選舉人", lambda e: f"{e.get('voterCount', 0)} / {e.get('rollSize')}" if e.get("rollSize") else "—", "right"),
            ("投票開始", lambda e: taipei_time(e.get("startsAt", "")) or "宣布開始"),
            ("投票截止", lambda e: taipei_time(e.get("endsAt", "")) or "宣布結束"),
        ])
        self.table.doubleClicked.connect(self.edit)
        self.table.itemSelectionChanged.connect(self.update_buttons)
        self.body.addWidget(self.table, 1)

        def button(text, slot):
            b = QPushButton(text)
            b.clicked.connect(slot)
            return b

        self.add_button = button("新增(&N)...", self.add)
        self.edit_button = button("編輯(&E)...", self.edit)
        self.delete_button = button("刪除(&D)", self.remove)
        self.publish_button = button("公告選舉公報", lambda: self.change("publish"))
        self.unpublish_button = button("撤回公告", lambda: self.change("unpublish"))
        self.open_button = button("開始投票", lambda: self.change("open"))
        self.close_button = button("結束投票", lambda: self.change("close"))
        self.results_button = button("公布結果", self.toggle_results)
        self.audit_button = button("稽核與開票(&A)...", self.audit)
        self.web_button = button("開啟投票頁面", self.open_web)
        self.body.addLayout(button_row(self.add_button, self.edit_button, self.delete_button, self.publish_button,
                                       self.unpublish_button))
        self.body.addLayout(button_row(self.open_button, self.close_button, self.results_button, self.audit_button,
                                       self.web_button))
        self.update_buttons()

    def selected(self) -> dict | None:
        return self.table.current_row_data()

    def update_buttons(self) -> None:
        e = self.selected() or {}
        status = e.get("status")
        president = self.role == "president"
        editable = status in ("draft", "published")
        self.edit_button.setEnabled(editable)
        self.delete_button.setEnabled(editable)
        self.publish_button.setEnabled(status == "draft")
        self.unpublish_button.setEnabled(status == "published")
        self.open_button.setEnabled(president and editable)
        self.close_button.setEnabled(president and status == "open")
        self.results_button.setEnabled(president and status == "closed")
        self.results_button.setText("隱藏結果" if e.get("resultsPublic") else "公布結果")
        self.audit_button.setEnabled(status in ("open", "closed"))
        self.web_button.setEnabled(status in ("published", "open", "closed"))

    def refresh(self) -> None:
        current = (self.selected() or {}).get("id")
        rows = self.api.elections()
        self.table.set_rows(rows)
        for index, row in enumerate(rows):
            if row.get("id") == current:
                self.table.selectRow(index)
        self.update_buttons()
        voting = sum(1 for e in rows if e.get("status") == "open")
        self.status(f"選舉 {len(rows)} 項，投票中 {voting} 項")

    def run(self, action) -> None:
        try:
            with busy():
                action()
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()

    def add(self) -> None:
        dialog = ElectionDialog(self)
        if dialog.exec() == QDialog.Accepted:
            self.run(lambda: self.api.create_election(dialog.values()))

    def edit(self) -> None:
        e = self.selected()
        if not e:
            QMessageBox.information(self, "編輯", "請先選取一項選舉。")
            return
        if e.get("status") not in ("draft", "published"):
            QMessageBox.information(self, "編輯", "投票開始後不能再修改選舉內容與候選人。")
            return
        dialog = ElectionDialog(self, e)
        if dialog.exec() == QDialog.Accepted:
            self.run(lambda: self.api.update_election(e["id"], dialog.values()))

    def remove(self) -> None:
        e = self.selected()
        if e and confirm(self, f"確定刪除「{e.get('title')}」？"):
            self.run(lambda: self.api.delete_election(e["id"]))

    CONFIRM = {
        "open": "開始投票後會依目前社員名冊鎖定選舉人名冊，選舉內容與候選人也不能再修改。確定開始？",
        "close": "結束投票後不再收票並開票。確定結束？",
        "publish-results": "公布後任何人都能在網站上看到開票結果。確定公布？",
    }

    def change(self, action: str) -> None:
        e = self.selected()
        if not e:
            return
        if action in self.CONFIRM and not confirm(self, self.CONFIRM[action]):
            return
        self.run(lambda: self.api.election_status(e["id"], action))

    def toggle_results(self) -> None:
        e = self.selected()
        if e:
            self.change("hide-results" if e.get("resultsPublic") else "publish-results")

    def audit(self) -> None:
        e = self.selected()
        if not e:
            return
        try:
            with busy():
                audit = self.api.election_audit(e["id"])
                results = self.api.election_results(e["id"]) if e.get("status") == "closed" else None
        except ApiError as error:
            show_error(self, error)
            return
        AuditDialog(self, e, audit, results).exec()

    def open_web(self) -> None:
        e = self.selected()
        if e:
            QDesktopServices.openUrl(QUrl(self.api.vote_page_url(e["id"])))
