"""社團法規 (read-only) and 我的帳號 pages, plus the change-password dialog."""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QDialog, QFormLayout, QGroupBox, QLabel, QLineEdit, QListWidget,
                               QListWidgetItem, QMessageBox, QPushButton, QSplitter, QTextBrowser)

from ..api import ROLE_LABELS, ApiError
from ..widgets import DataTable, Page, busy, button_row, money, show_error
from .members import FEE_TYPE_LABELS, dialog_buttons


class RegulationsPage(Page):
    title = "社團法規查詢"
    icon_name = "regulations"

    def __init__(self, *args):
        super().__init__(*args)
        splitter = QSplitter(Qt.Horizontal)
        self.list = QListWidget()
        self.list.currentItemChanged.connect(self.show_regulation)
        self.text = QTextBrowser()
        splitter.addWidget(self.list)
        splitter.addWidget(self.text)
        splitter.setSizes([220, 600])
        self.body.addWidget(splitter, 1)
        self.body.addWidget(QLabel("法規只能經由修正案程序變更，請至網站後台登錄修正案。"))

    def refresh(self) -> None:
        self.list.clear()
        regulations = self.api.regulations()
        for regulation in regulations:
            title = regulation.get("title", "")
            if regulation.get("repealed"):
                title += "（已廢止）"
            item = QListWidgetItem(title)
            item.setData(Qt.UserRole, regulation)
            item.setToolTip(f"{regulation.get('category', '')}　{regulation.get('version', '')}")
            self.list.addItem(item)
        if self.list.count():
            self.list.setCurrentRow(0)
        self.status(f"法規 {len(regulations)} 種")

    def show_regulation(self, item) -> None:
        if not item:
            self.text.clear()
            return
        regulation = item.data(Qt.UserRole)
        self.text.setPlainText(f"{regulation.get('title', '')}\n"
                               f"〔{regulation.get('category', '')}　{regulation.get('version', '')}〕\n\n"
                               f"{regulation.get('content', '')}")


class PasswordDialog(QDialog):
    def __init__(self, parent):
        super().__init__(parent)
        self.setWindowTitle("變更密碼")
        self.old = QLineEdit()
        self.new = QLineEdit()
        self.again = QLineEdit()
        for edit in (self.old, self.new, self.again):
            edit.setEchoMode(QLineEdit.Password)
        form = QFormLayout(self)
        form.addRow("目前密碼：", self.old)
        form.addRow("新密碼：", self.new)
        form.addRow("確認新密碼：", self.again)
        form.addRow(QLabel("新密碼至少 8 個字元。變更後所有電腦都需要重新登入。"))
        form.addRow(dialog_buttons(self))

    def accept(self) -> None:
        if len(self.new.text()) < 8:
            QMessageBox.warning(self, "變更密碼", "新密碼至少需要 8 個字元。")
        elif self.new.text() != self.again.text():
            QMessageBox.warning(self, "變更密碼", "兩次輸入的新密碼不相同。")
        else:
            super().accept()


class AccountPage(Page):
    title = "我的帳號"
    icon_name = "account"

    def __init__(self, *args):
        super().__init__(*args)
        account = QGroupBox("帳號資料")
        self.account_form = QFormLayout(account)
        self.body.addWidget(account)
        member = QGroupBox("綁定的社員資料")
        self.member_form = QFormLayout(member)
        self.body.addWidget(member)
        self.body.addWidget(QLabel("社費繳費紀錄："))
        self.table = DataTable([
            ("繳費日期", "date"), ("學期", "semester"), ("金額", lambda r: money(r.get("amount")), "right"),
            ("類別", lambda r: FEE_TYPE_LABELS.get(r.get("feeType"), "")), ("收據編號", "receiptNumber"),
        ])
        self.body.addWidget(self.table, 1)
        change = QPushButton("變更密碼(&P)...")
        change.clicked.connect(self.change_password)
        self.body.addLayout(button_row(change))

    @staticmethod
    def fill(form: QFormLayout, rows) -> None:
        while form.rowCount():
            form.removeRow(0)
        for label, value in rows:
            field = QLabel(str(value) if value not in (None, "") else "—")
            field.setTextInteractionFlags(Qt.TextSelectableByMouse)
            form.addRow(label + "：", field)

    def refresh(self) -> None:
        me = self.api.me()
        self.fill(self.account_form, [("帳號", me.get("username")), ("角色", ROLE_LABELS.get(me.get("role"), me.get("role"))),
                                      ("建立日期", (me.get("createdAt") or "")[:10])])
        member = me.get("member")
        if member:
            status = member.get("status", {})
            self.fill(self.member_form, [
                ("姓名", member.get("name")), ("學號", member.get("studentId")), ("Email", member.get("email")),
                ("電話", member.get("phone")), ("職務", member.get("position")), ("加入日期", member.get("joinedAt")),
                ("社員身分", status.get("levelLabel")), ("社費", status.get("feeLabel")),
                ("表決權", "有" if status.get("voting") else "無"),
            ])
        else:
            self.fill(self.member_form, [("狀態", "此帳號尚未綁定社員資料，請洽社長。")])
        self.table.set_rows(me.get("feeReceipts", []))
        self.status("帳號資料已更新")

    def change_password(self) -> None:
        dialog = PasswordDialog(self)
        if dialog.exec() != QDialog.Accepted:
            return
        try:
            with busy():
                self.api.change_password(dialog.old.text(), dialog.new.text())
        except ApiError as error:
            show_error(self, error)
            return
        # The server signs out every session of this account when the password changes.
        QMessageBox.information(self, "變更密碼", "密碼已變更，請使用新密碼重新登入。")
        relogin = getattr(self.window(), "relogin", None)
        if relogin:
            relogin()
