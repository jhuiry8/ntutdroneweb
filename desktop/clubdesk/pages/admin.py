"""社課備忘錄, 帳號與權限 (with site settings), AI 週報 and AI 社務助理 pages."""

from __future__ import annotations

import html
import re

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QFormLayout, QGroupBox, QHBoxLayout, QInputDialog,
                               QLabel, QLineEdit, QMessageBox, QPlainTextEdit, QSplitter, QTableWidget,
                               QTableWidgetItem, QTextBrowser, QVBoxLayout, QWidget)

from ..api import ROLE_LABELS, ApiError, can_edit_cms, can_manage_finance, can_manage_users
from ..docx import Document
from ..widgets import (DataTable, Page, background, busy, button_row, confirm, docx_path, export_info, icon_button,
                       open_url, save_docx, show_error)
from .members import combo, date_edit, date_text, dialog_buttons

ROLES = [("member", "社員"), ("cadre", "幹部"), ("finance", "財務"), ("president", "社長")]


def rich_text(text: str) -> str:
    """Plain text from people or AI as safe HTML: escaped, links clickable, **bold** kept."""
    value = html.escape(text or "")
    value = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"(https?://[^\s<]+)", r'<a href="\1">\1</a>', value)
    return value.replace("\n", "<br>")


# ───────────────────────────── 社課備忘錄 ─────────────────────────────

class NoteDialog(QDialog):
    def __init__(self, parent):
        super().__init__(parent)
        self.setWindowTitle("新增社課紀錄")
        self.title = QLineEdit()
        self.title.setPlaceholderText("例如 第 3 次社課：PID 調參")
        self.date = date_edit()
        self.content = QPlainTextEdit()
        self.content.setPlaceholderText("上課重點、作業、下次準備事項")
        self.links = QPlainTextEdit()
        self.links.setPlaceholderText("相關網址，一行一個；可寫「名稱 https://...」\n例如 投影片 https://docs.google.com/...")
        self.links.setFixedHeight(80)
        form = QFormLayout()
        form.addRow("社課名稱：", self.title)
        form.addRow("日期：", self.date)
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(QLabel("內容："))
        layout.addWidget(self.content, 1)
        layout.addWidget(QLabel("相關連結："))
        layout.addWidget(self.links)
        layout.addWidget(dialog_buttons(self))
        self.resize(480, 460)

    def accept(self) -> None:
        if not self.title.text().strip():
            QMessageBox.warning(self, "資料不完整", "請填寫社課名稱。")
            return
        super().accept()

    def values(self) -> dict:
        links = []
        for line in self.links.toPlainText().splitlines():
            match = re.search(r"https?://\S+", line)
            if match:
                label = line[:match.start()].strip(" ：:-")
                links.append({"label": label or match.group(0), "url": match.group(0)})
        return {"title": self.title.text().strip(), "date": date_text(self.date), "content": self.content.toPlainText().strip(), "links": links}


class NotesPage(Page):
    title = "社課備忘錄"
    icon_name = "notes"
    export_name = "社課備忘錄.csv"

    def __init__(self, *args):
        super().__init__(*args)
        splitter = QSplitter(Qt.Vertical)
        self.table = DataTable([("日期", "date"), ("社課名稱", "title"), ("連結數", lambda n: len(n.get("links", []))), ("建立者", "createdBy")])
        self.table.itemSelectionChanged.connect(self.show_note)
        self.detail = QTextBrowser()
        self.detail.setOpenExternalLinks(True)
        splitter.addWidget(self.table)
        splitter.addWidget(self.detail)
        splitter.setSizes([300, 220])
        self.body.addWidget(splitter, 1)
        add = icon_button("新增(&N)...", "add")
        add.clicked.connect(self.add)
        remove = icon_button("刪除(&D)", "delete")
        remove.clicked.connect(self.remove)
        add.setEnabled(can_edit_cms(self.role))
        remove.setEnabled(can_edit_cms(self.role))
        self.body.addLayout(button_row(add, remove))

    def refresh(self) -> None:
        self.table.set_rows(self.api.notes())
        self.detail.clear()
        self.status(f"社課紀錄 {self.table.rowCount()} 則")

    def show_note(self) -> None:
        note = self.table.current_row_data()
        if not note:
            self.detail.clear()
            return
        links = "".join(f'<li><a href="{html.escape(link["url"])}">{html.escape(link.get("label") or link["url"])}</a></li>' for link in note.get("links", []))
        self.detail.setHtml(f"<h3>{html.escape(note.get('title', ''))}</h3><p>{html.escape(note.get('date', ''))}・{html.escape(note.get('createdBy', ''))}</p>"
                            f"<p>{rich_text(note.get('content', ''))}</p>" + (f"<ul>{links}</ul>" if links else ""))

    def export_docx(self) -> None:
        """All class notes with their content and links (as shown, newest first)."""
        notes = self.table.rows
        if not notes:
            QMessageBox.information(self, "匯出 Word", "目前沒有社課紀錄。")
            return
        path = docx_path(self, "社課備忘錄.docx")
        if not path:
            return
        document = Document("社課備忘錄")
        document.title_block("社課備忘錄", export_info(self.user, self.api.base_url))
        for note in notes:
            document.heading(f"{note.get('date', '')}　{note.get('title', '')}", 2)
            for line in (note.get("content") or "").splitlines():
                document.paragraph(line)
            links = [f"[{link.get('label') or link['url']}]({link['url']})" for link in note.get("links", [])]
            if links:
                document.bullets(links)
            document.paragraph(f"建立者：{note.get('createdBy', '')}", size=18)
        save_docx(self, document, path)

    def add(self) -> None:
        dialog = NoteDialog(self)
        if dialog.exec() != QDialog.Accepted:
            return
        try:
            with busy():
                self.api.create_note(dialog.values())
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()

    def remove(self) -> None:
        note = self.table.current_row_data()
        if not note or not confirm(self, f"確定刪除社課紀錄「{note.get('title')}」？"):
            return
        try:
            with busy():
                self.api.delete_note(note["id"])
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()


# ───────────────────────────── 帳號與權限 ─────────────────────────────

class AccountDialog(QDialog):
    def __init__(self, parent, members: list[dict], user: dict | None = None):
        super().__init__(parent)
        self.setWindowTitle(f"修改帳號 {user['username']}" if user else "新增帳號")
        self.username = QLineEdit(user.get("username", "") if user else "")
        self.username.setEnabled(user is None)
        self.username.setPlaceholderText("3–40 位英數字、點、底線或連字號")
        self.password = QLineEdit()
        self.password.setEchoMode(QLineEdit.Password)
        self.password.setPlaceholderText("至少 8 個字元" + ("；留空表示不變更" if user else ""))
        self.role = combo(ROLES, user.get("role", "member") if user else "member")
        self.active = QCheckBox("啟用（停用後對方會立即被登出）")
        self.active.setChecked(user.get("active", True) if user else True)
        self.active.setEnabled(user is not None)
        self.member = QComboBox()
        self.member.addItem("不綁定社員", "")
        owner = user.get("username") if user else ""
        for member in members:
            if member.get("account") and member.get("account") != owner:
                continue
            status = member.get("status", {})
            self.member.addItem(f"{member.get('name') or '姓名待查'}（{member.get('studentId') or '無學號'}）・{status.get('levelLabel', '')}", member["id"])
        index = self.member.findData(user.get("memberId", "") if user else "")
        self.member.setCurrentIndex(max(index, 0))
        form = QFormLayout(self)
        form.addRow("帳號：", self.username)
        form.addRow("密碼：", self.password)
        form.addRow("角色：", self.role)
        form.addRow("綁定社員：", self.member)
        form.addRow("", self.active)
        form.addRow(QLabel("社長：全部功能。財務：社員、社費、帳目。幹部：網站、器材、會議。社員：表單、投票、訊息。"))
        form.addRow(dialog_buttons(self))
        self.is_new = user is None
        self.setMinimumWidth(420)

    def accept(self) -> None:
        if self.is_new and not re.match(r"^[a-z0-9._-]{3,40}$", self.username.text().strip().lower()):
            QMessageBox.warning(self, "帳號", "帳號須為 3–40 位英數字、點、底線或連字號。")
            return
        if (self.is_new or self.password.text()) and len(self.password.text()) < 8:
            QMessageBox.warning(self, "密碼", "密碼至少需要 8 個字元。")
            return
        super().accept()


class UsersPage(Page):
    title = "帳號與權限"
    icon_name = "users"
    export_name = "帳號清單.csv"

    def __init__(self, *args):
        super().__init__(*args)
        settings = QGroupBox("網站設定")
        row = QHBoxLayout(settings)
        self.member_login = QCheckBox("開放「社員」角色的帳號登入（關閉時社員開會改用學號＋姓名簽到）")
        self.member_login.toggled.connect(self.save_member_login)
        row.addWidget(self.member_login, 1)
        self.body.addWidget(settings)
        self.table = DataTable([
            ("帳號", "username"), ("角色", lambda u: ROLE_LABELS.get(u.get("role"), u.get("role"))),
            ("狀態", lambda u: "啟用" if u.get("active") else "停用"),
            ("綁定社員", lambda u: (f"{u['member'].get('name') or '姓名待查'}（{u['member'].get('studentId') or '無學號'}）・"
                                   f"{u['member'].get('status', {}).get('levelLabel', '')}・{u['member'].get('status', {}).get('feeLabel', '')}")
             if u.get("member") else "未綁定"),
            ("建立日期", lambda u: (u.get("createdAt") or "")[:10]),
        ])
        self.table.doubleClicked.connect(self.edit)
        self.body.addWidget(self.table, 1)
        add = icon_button("新增帳號(&N)...", "add")
        add.clicked.connect(self.add)
        edit = icon_button("修改(&E)...", "edit")
        edit.clicked.connect(self.edit)
        toggle = icon_button("停用／啟用", "cross")
        toggle.clicked.connect(self.toggle)
        reset = icon_button("重設密碼...", "password")
        reset.clicked.connect(self.reset_password)
        self.body.addLayout(button_row(add, edit, toggle, reset))
        self.members: list[dict] = []
        self._loading = False

    def refresh(self) -> None:
        self.table.set_rows(self.api.users())
        try:
            self.members = self.api.members()
        except ApiError:
            self.members = []
        self._loading = True
        self.member_login.setChecked(bool(self.api.site_settings().get("memberLogin", True)))
        self._loading = False
        active = sum(1 for u in self.table.rows if u.get("active"))
        self.status(f"帳號 {len(self.table.rows)} 個，啟用 {active} 個")

    def save_member_login(self, on: bool) -> None:
        if self._loading:
            return
        try:
            with busy():
                self.api.save_site_settings({"memberLogin": on})
        except ApiError as error:
            show_error(self, error)
        self.status("網站設定已儲存")

    def update(self, username: str, changes: dict) -> None:
        try:
            with busy():
                self.api.update_user({"username": username, **changes})
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()

    def selected(self) -> dict | None:
        user = self.table.current_row_data()
        if not user:
            QMessageBox.information(self, self.title, "請先選取一個帳號。")
        return user

    def add(self) -> None:
        dialog = AccountDialog(self, self.members)
        if dialog.exec() != QDialog.Accepted:
            return
        try:
            with busy():
                self.api.create_user({"username": dialog.username.text().strip().lower(), "password": dialog.password.text(),
                                      "role": dialog.role.currentData(), "memberId": dialog.member.currentData()})
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()

    def edit(self) -> None:
        user = self.selected()
        if not user:
            return
        dialog = AccountDialog(self, self.members, user)
        if dialog.exec() != QDialog.Accepted:
            return
        changes = {}
        if dialog.member.currentData() != (user.get("memberId") or ""):
            changes["memberId"] = dialog.member.currentData()
        if dialog.role.currentData() != user.get("role"):
            changes["role"] = dialog.role.currentData()
        if dialog.active.isChecked() != bool(user.get("active")):
            changes["active"] = dialog.active.isChecked()
        if dialog.password.text():
            changes["password"] = dialog.password.text()
        if changes:
            self.update(user["username"], changes)

    def toggle(self) -> None:
        user = self.selected()
        if not user:
            return
        if user.get("active") and not confirm(self, f"確定停用帳號 {user['username']}？停用後對方會立即被登出。"):
            return
        self.update(user["username"], {"active": not user.get("active")})

    def reset_password(self) -> None:
        user = self.selected()
        if not user:
            return
        password, ok = QInputDialog.getText(self, "重設密碼", f"{user['username']} 的新密碼（至少 8 位）：", QLineEdit.Password)
        if not ok or not password:
            return
        if len(password) < 8:
            QMessageBox.warning(self, "重設密碼", "密碼至少需要 8 個字元。")
            return
        self.update(user["username"], {"password": password})


# ───────────────────────────── AI 社務助理 ─────────────────────────────

TOOL_LABELS = {"search_regulations": "法規條文", "open_amendments": "修正案", "my_forms": "我的表單", "club_overview": "社團概況",
               "recent_forms": "表單紀錄", "list_posts": "官網文章", "class_notes": "社課備忘錄", "finance_summary": "財務總覽",
               "search_transactions": "帳目", "query_members": "社員名冊", "query_equipment": "設備清冊", "equipment_loans": "設備借用",
               "meetings": "會議"}


class AssistantPage(Page):
    title = "AI 社務助理"
    icon_name = "ai"

    def __init__(self, *args):
        super().__init__(*args)
        self.history: list[dict] = []
        self.status_info: dict = {}
        self.info = QLabel()
        self.info.setWordWrap(True)
        self.body.addWidget(self.info)
        self.log = QTextBrowser()
        self.log.setOpenExternalLinks(False)
        self.log.anchorClicked.connect(self.run_action)
        self.body.addWidget(self.log, 1)
        chips = QHBoxLayout()
        for question in ("這學期還有誰沒繳社費？", "目前帳戶餘額多少？", "有哪些器材在維修中？", "幫我寫一篇期末成果展的公告草稿"):
            button = icon_button(question, "lightbulb")
            button.clicked.connect(lambda _=False, q=question: self.send(q))
            chips.addWidget(button)
        chips.addStretch(1)
        self.body.addLayout(chips)
        row = QHBoxLayout()
        self.input = QLineEdit()
        self.input.setPlaceholderText("問我社團的大小事，例如社費、器材、法規條文，或請我寫公告草稿（Enter 送出）")
        self.input.returnPressed.connect(lambda: self.send(self.input.text()))
        self.send_button = icon_button("送出", "ai")
        self.send_button.clicked.connect(lambda: self.send(self.input.text()))
        clear = icon_button("清除對話", "delete")
        clear.clicked.connect(self.clear)
        row.addWidget(self.input, 1)
        row.addWidget(self.send_button)
        row.addWidget(clear)
        self.body.addLayout(row)
        self.render()

    def refresh(self) -> None:
        self.status_info = self.api.ai_status()
        if self.status_info.get("enabled"):
            self.info.setText(f"AI 模型：{self.status_info.get('provider')} {self.status_info.get('model')}，每人每日 {self.status_info.get('dailyLimit')} 次。"
                              "助理只會查詢您有權限看的資料；建議的動作需要您按下才會執行。")
        else:
            self.info.setText("網站尚未設定 AI 金鑰（GROQ_API_KEY 或 GEMINI_API_KEY），請社長到 Cloudflare 設定後再使用。")
        self.send_button.setEnabled(bool(self.status_info.get("enabled")))

    def clear(self) -> None:
        self.history = []
        self.render()

    def export_docx(self) -> None:
        turns = [m for m in self.history if not m.get("pending")]
        if not turns:
            QMessageBox.information(self, "匯出 Word", "目前沒有對話內容。")
            return
        path = docx_path(self, "AI 社務助理對話.docx")
        if not path:
            return
        document = Document("AI 社務助理對話")
        document.title_block("AI 社務助理對話", export_info(self.user, self.api.base_url))
        for message in turns:
            document.heading("您" if message["role"] == "user" else "助理", 3)
            document.markdown(message.get("content", ""))
        save_docx(self, document, path)

    def render(self) -> None:
        if not self.history:
            self.log.setHtml("<p style='color:#606060'>可以問我社團的大小事，例如社費、設備、法規條文，或請我幫忙寫公告草稿。</p>")
            return
        parts = []
        for index, message in enumerate(self.history):
            if message["role"] == "user":
                parts.append(f"<p style='background:#E8EEF8; padding:4px;'><b>您：</b>{rich_text(message['content'])}</p>")
                continue
            body = f"<p><b>助理：</b>{rich_text(message['content'])}</p>"
            for number, action in enumerate(message.get("actions", [])):
                link = f"action:{index}:{number}"
                if action["type"] == "post_draft":
                    body += f"<p>📝 文章草稿「{html.escape(action.get('title') or '未命名')}」　<a href='{link}'>在文章編輯器開啟</a></p>"
                elif action["type"] == "finance_transaction":
                    kind = {"income": "收入", "expense": "支出", "transfer": "轉帳"}.get(action["kind"], "")
                    body += (f"<p>💰 建議帳目：{html.escape(action['date'])}「{html.escape(action['item'])}」{kind} {action['amount']:,} 元"
                             f"　<a href='{link}'>送出給社長審核</a></p>")
            if message.get("tools"):
                body += f"<p style='color:#606060; font-size:9pt'>查詢了：{'、'.join(TOOL_LABELS.get(t, t) for t in message['tools'])}</p>"
            parts.append(body)
        self.log.setHtml("".join(parts))
        self.log.verticalScrollBar().setValue(self.log.verticalScrollBar().maximum())

    def send(self, text: str) -> None:
        text = text.strip()
        if not text or not self.send_button.isEnabled():
            return
        self.input.clear()
        self.history.append({"role": "user", "content": text})
        payload = [{"role": m["role"], "content": m["content"]} for m in self.history if not m.get("error")]
        self.history.append({"role": "assistant", "content": "思考中…", "pending": True})
        self.render()
        self.send_button.setEnabled(False)

        def done(data):
            self.history[-1] = {"role": "assistant", "content": data.get("reply", ""), "actions": data.get("actions", []), "tools": data.get("tools", [])}
            self.send_button.setEnabled(True)
            self.render()

        def failed(error):
            self.history[-1] = {"role": "assistant", "content": f"⚠ {error}", "error": True}
            self.send_button.setEnabled(True)
            self.render()

        background(lambda: self.api.ai_assistant(payload), done, failed)

    def run_action(self, url) -> None:
        _, message, number = url.toString().split(":")
        action = self.history[int(message)]["actions"][int(number)]
        if action["type"] == "post_draft":
            from .website import ContentEditor
            if not can_edit_cms(self.role):
                QMessageBox.information(self, "文章草稿", "您沒有編輯文章的權限。")
                return
            editor = ContentEditor(self, self.api, "post", None, bool(self.status_info.get("enabled")))
            editor.fill({**action, "force_slug": True})
            if editor.exec() == QDialog.Accepted:
                self.status("文章已儲存")
        elif action["type"] == "finance_transaction":
            if not confirm(self, "確定送出這筆帳目？送出後仍需社長審核才會計入餘額。"):
                return
            try:
                with busy():
                    self.api.create_transaction({"date": action["date"], "item": action["item"], "kind": action["kind"],
                                                 "account": action["account"], "amount": action["amount"], "budgetId": ""})
            except ApiError as error:
                show_error(self, error)
                return
            QMessageBox.information(self, "帳目", "已送出待審核帳目。")


# ───────────────────────────── 社團週報 ─────────────────────────────

class ReportsPage(Page):
    title = "社團週報"
    icon_name = "reports"

    def __init__(self, *args):
        super().__init__(*args)
        self.body.addWidget(QLabel("每週一早上 9 點自動產生；有設定 REPORT_WEBHOOK_URL 時也會發到 Discord／Slack。"))
        splitter = QSplitter(Qt.Horizontal)
        self.table = DataTable([("產生時間", lambda r: (r.get("createdAt") or "")[:16].replace("T", " ")),
                                ("方式", lambda r: "自動" if r.get("trigger") == "cron" else f"手動（{r.get('createdBy', '')}）"),
                                ("推播", lambda r: {"sent": "已發送", "skipped": "未設定"}.get(r.get("webhook"), r.get("webhook", "")))])
        self.table.itemSelectionChanged.connect(self.show_report)
        self.text = QTextBrowser()
        splitter.addWidget(self.table)
        splitter.addWidget(self.text)
        splitter.setSizes([300, 600])
        self.body.addWidget(splitter, 1)
        create = icon_button("立即產生週報", "ai")
        create.clicked.connect(self.create)
        create.setEnabled(can_manage_finance(self.role))
        self.body.addLayout(button_row(create))

    def refresh(self) -> None:
        self.table.set_rows(self.api.reports())
        if self.table.rowCount():
            self.table.selectRow(0)
        self.status(f"週報 {self.table.rowCount()} 份")

    def show_report(self) -> None:
        report = self.table.current_row_data()
        if not report:
            self.text.clear()
            return
        note = f"<p style='color:#A11D1D'>AI 摘要失敗：{html.escape(report['aiError'])}</p>" if report.get("aiError") else ""
        self.text.setHtml(f"<p>{rich_text(report.get('text', ''))}</p>" + note)

    def export_docx(self) -> None:
        report = self.table.current_row_data()
        if not report:
            QMessageBox.information(self, "匯出 Word", "請先選取一份週報。")
            return
        stamp = (report.get("createdAt") or "")[:10]
        path = docx_path(self, f"社團週報-{stamp}.docx")
        if not path:
            return
        document = Document(f"社團週報 {stamp}")
        document.title_block(f"北科無人機社 社團週報（{stamp}）", export_info(self.user, self.api.base_url))
        document.markdown(report.get("text", ""))
        save_docx(self, document, path)

    def create(self) -> None:
        try:
            with busy():
                self.api.create_report()
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()
