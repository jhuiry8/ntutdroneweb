"""活動報名 page: events, their sign-up limits and the registration list (officers)."""

from __future__ import annotations

from PySide6.QtWidgets import (QCheckBox, QDialog, QFormLayout, QHBoxLayout, QInputDialog, QLabel, QLineEdit,
                               QMessageBox, QPlainTextEdit, QPushButton, QSpinBox, QVBoxLayout)

from ..api import ApiError
from ..i18n import raw
from ..widgets import DataTable, Page, busy, button_row, confirm, show_error
from .members import combo, dialog_buttons

CATEGORIES = [("flight", "飛行日"), ("competition", "比賽"), ("talk", "講座"), ("trip", "出遊"), ("other", "其他")]
AUDIENCES = [("public", "公開"), ("members", "社員"), ("officers", "幹部")]
REG_STATUS = {"confirmed": "已報名", "waitlist": "候補"}
REG_KIND = {"member": "社員帳號", "guest": "訪客", "manual": "幹部加入"}
CATEGORY_LABELS = dict(CATEGORIES)
AUDIENCE_LABELS = dict(AUDIENCES)


def _local(value: str) -> str:
    """'2026-12-01T19:00' (Taipei) -> '2026-12-01 19:00' for display and editing."""
    return (value or "").replace("T", " ")[:16]


class EventDialog(QDialog):
    """Create or edit an event. Times are Taipei local time, 'YYYY-MM-DD HH:MM' (the server's own format)."""

    def __init__(self, parent, event: dict | None = None):
        super().__init__(parent)
        event = event or {}
        self.setWindowTitle(f"修改活動 {raw(event.get('title', ''))}" if event else "新增活動")
        self.title_edit = QLineEdit(event.get("title", ""))
        self.category = combo(CATEGORIES, event.get("category", "other"))
        self.starts = QLineEdit(_local(event.get("startsLocal", "")))
        self.starts.setPlaceholderText("例如 2026-12-01 09:00")
        self.ends = QLineEdit(_local(event.get("endsLocal", "")))
        self.ends.setPlaceholderText("可留空")
        self.deadline = QLineEdit(_local(event.get("deadlineLocal", "")))
        self.deadline.setPlaceholderText("留空 = 活動開始時截止")
        self.location = QLineEdit(event.get("location", ""))
        self.capacity = QSpinBox()
        self.capacity.setRange(0, 5000)
        self.capacity.setSpecialValueText("不限")
        self.capacity.setValue(int(event.get("capacity") or 0))
        self.audience = combo(AUDIENCES, event.get("audience", "public"))
        self.fee_required = QCheckBox("需要繳費")
        self.fee_required.setChecked(bool(event.get("feeRequired")))
        self.fee_amount = QSpinBox()
        self.fee_amount.setRange(0, 100000)
        self.fee_amount.setSuffix(" 元")
        self.fee_amount.setValue(int(event.get("feeAmount") or 0))
        self.description = QPlainTextEdit(event.get("description", ""))
        self.description.setPlaceholderText("活動說明（支援 Markdown，會顯示在活動頁）")
        self.description.setFixedHeight(90)
        form = QFormLayout()
        form.addRow("活動名稱：", self.title_edit)
        form.addRow("類別：", self.category)
        form.addRow("開始時間：", self.starts)
        form.addRow("結束時間：", self.ends)
        form.addRow("報名截止：", self.deadline)
        form.addRow("地點：", self.location)
        form.addRow("名額：", self.capacity)
        form.addRow("報名對象：", self.audience)
        fee = QHBoxLayout()
        fee.addWidget(self.fee_required)
        fee.addWidget(self.fee_amount, 1)
        form.addRow("費用：", fee)
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(QLabel("說明："))
        layout.addWidget(self.description)
        layout.addWidget(dialog_buttons(self))
        self.setMinimumWidth(420)

    def accept(self) -> None:
        if not self.title_edit.text().strip():
            QMessageBox.warning(self, "資料不完整", "請填寫活動名稱。")
            return
        if not self.starts.text().strip():
            QMessageBox.warning(self, "資料不完整", "請填寫開始時間（格式：2026-12-01 09:00）。")
            return
        super().accept()

    def values(self) -> dict:
        return {"title": self.title_edit.text().strip(), "category": self.category.currentData(),
                "startsAt": self.starts.text().strip(), "endsAt": self.ends.text().strip(),
                "registrationDeadline": self.deadline.text().strip(), "location": self.location.text().strip(),
                "capacity": self.capacity.value(), "audience": self.audience.currentData(),
                "feeRequired": self.fee_required.isChecked(), "feeAmount": self.fee_amount.value(),
                "description": self.description.toPlainText().strip()}


class RegistrationsDialog(QDialog):
    """Sign-up list of one event: add someone by hand, remove, mark paid."""

    def __init__(self, page: "EventsPage", event: dict):
        super().__init__(page)
        self.page = page
        self.event_data = event
        self.setWindowTitle(f"報名名單 - {raw(event.get('title', ''))}")
        self.summary = QLabel()
        self.table = DataTable([
            ("順位", "order"), ("狀態", lambda r: REG_STATUS.get(r.get("status"), "")),
            ("姓名", "name"), ("學號", "studentId"), ("Email", "email"),
            ("報名方式", lambda r: REG_KIND.get(r.get("kind"), r.get("kind", ""))), ("帳號", "username"),
            ("已繳費", lambda r: ("是" if r.get("paid") else "否") if event.get("feeRequired") else ""),
        ], multi=True)
        add = QPushButton("手動加入(&A)...")
        add.clicked.connect(self.add)
        remove = QPushButton("移除(&R)")
        remove.clicked.connect(self.remove)
        paid = QPushButton("切換已繳費(&P)")
        paid.clicked.connect(self.toggle_paid)
        close = QPushButton("關閉")
        close.clicked.connect(self.accept)
        layout = QVBoxLayout(self)
        layout.addWidget(self.summary)
        layout.addWidget(self.table, 1)
        layout.addLayout(button_row(add, remove, paid, close))
        self.resize(760, 460)
        self.reload()

    def _event_id(self) -> str:
        return self.event_data["id"]

    def reload(self) -> None:
        data = self.page.api.event_registrations(self._event_id())
        self.event_data = data.get("event", self.event_data)
        regs = data.get("registrations", [])
        self.table.set_rows(regs)
        self.summary.setText(f"已報名 {self.event_data.get('confirmed', 0)} 人，候補 {self.event_data.get('waitlist', 0)} 人")

    def _run(self, action) -> None:
        try:
            with busy():
                action()
                self.reload()
        except ApiError as error:
            show_error(self, error)

    def add(self) -> None:
        name, ok = _ask(self, "手動加入", "姓名：")
        if not ok or not name.strip():
            return
        student_id, _ = _ask(self, "手動加入", "學號（可留空）：")
        email, _ = _ask(self, "手動加入", "Email（可留空）：")
        # Same as the web: a full event only takes this person as a confirmed place when the officer says so.
        force = confirm(self, "名額已滿時，仍要直接列為正式名額嗎？\n（選「否」會排入候補名單。）", "手動加入")
        person = {"name": name.strip(), "studentId": student_id.strip(), "email": email.strip(), "force": force}
        self._run(lambda: self.page.api.add_event_registration(self._event_id(), person))

    def remove(self) -> None:
        row = self.table.current_row_data()
        if not row:
            QMessageBox.information(self, "移除", "請先選取一位報名者。")
            return
        if not confirm(self, f"確定要移除「{row.get('name', '')}」的報名嗎？", "移除報名"):
            return
        self._run(lambda: self.page.api.remove_event_registration(self._event_id(), row["id"]))

    def toggle_paid(self) -> None:
        row = self.table.current_row_data()
        if not row:
            QMessageBox.information(self, "已繳費", "請先選取一位報名者。")
            return
        self._run(lambda: self.page.api.set_event_registration_paid(self._event_id(), row["id"], not row.get("paid")))


def _ask(parent, title: str, label: str) -> tuple:
    return QInputDialog.getText(parent, title, label)


class EventsPage(Page):
    title = "活動報名"
    icon_name = "calendar"
    export_name = "活動報名.csv"

    def __init__(self, *args):
        super().__init__(*args)
        self.table = DataTable([
            ("開始時間", lambda e: _local(e.get("startsLocal") or e.get("startsAt", ""))),
            ("類別", lambda e: e.get("categoryLabel", "")),
            ("活動名稱", "title"),
            ("地點", "location"),
            ("對象", lambda e: e.get("audienceLabel", "")),
            ("報名人數", lambda e: f"{e.get('confirmed', 0)} / {e['capacity']}" if e.get("capacity") else f"{e.get('confirmed', 0)} / 不限", "right"),
            ("候補", lambda e: str(e.get("waitlist", 0)), "right"),
            ("報名截止", lambda e: _local(e.get("deadlineLocal") or "")),
            ("狀態", lambda e: "報名中" if e.get("open") else "已截止"),
            ("費用", lambda e: f"{e.get('feeAmount', 0)} 元" if e.get("feeRequired") else "免費"),
        ])
        self.table.doubleClicked.connect(self.edit)
        self.body.addWidget(self.table, 1)
        add = QPushButton("新增(&N)...")
        add.clicked.connect(self.add)
        edit = QPushButton("修改(&E)...")
        edit.clicked.connect(self.edit)
        regs = QPushButton("報名名單(&R)...")
        regs.clicked.connect(self.registrations)
        delete = QPushButton("刪除(&D)")
        delete.clicked.connect(self.delete)
        self.body.addLayout(button_row(add, edit, regs, delete))

    def refresh(self) -> None:
        rows = self.api.events()
        rows.sort(key=lambda e: e.get("startsAt", ""), reverse=True)
        self.table.set_rows(rows)
        self.status(f"活動 {len(rows)} 場")

    def _save(self, action) -> None:
        try:
            with busy():
                action()
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()

    def add(self) -> None:
        dialog = EventDialog(self)
        if dialog.exec() == QDialog.Accepted:
            self._save(lambda: self.api.create_event(dialog.values()))

    def edit(self) -> None:
        event = self.table.current_row_data()
        if not event:
            QMessageBox.information(self, "修改", "請先選取一場活動。")
            return
        dialog = EventDialog(self, event)
        if dialog.exec() == QDialog.Accepted:
            self._save(lambda: self.api.update_event(event["id"], dialog.values()))

    def registrations(self) -> None:
        event = self.table.current_row_data()
        if not event:
            QMessageBox.information(self, "報名名單", "請先選取一場活動。")
            return
        try:
            with busy():
                dialog = RegistrationsDialog(self, event)
        except ApiError as error:
            show_error(self, error)
            return
        dialog.exec()
        self.safe_refresh()

    def delete(self) -> None:
        event = self.table.current_row_data()
        if not event:
            QMessageBox.information(self, "刪除", "請先選取一場活動。")
            return
        if not confirm(self, f"確定要刪除活動「{event.get('title', '')}」嗎？所有報名紀錄也會一併刪除，無法復原。", "刪除活動"):
            return
        self._save(lambda: self.api.delete_event(event["id"]))
