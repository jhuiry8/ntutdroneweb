"""社員名冊 and 社費簽收 pages."""

from __future__ import annotations

import csv
from datetime import date

from PySide6.QtCore import QDate
from PySide6.QtWidgets import (QComboBox, QDateEdit, QDialog, QDialogButtonBox, QFileDialog,
                               QFormLayout, QGroupBox, QHBoxLayout, QLabel, QLineEdit,
                               QMessageBox, QPlainTextEdit, QPushButton, QSpinBox, QVBoxLayout)

from ..api import ApiError
from ..widgets import DataTable, Page, busy, button_row, confirm, money, show_error

LEVELS = [("trial", "非正式社員"), ("member", "正式社員"), ("prep", "籌備幹部"), ("officer", "正式幹部")]
FEES = [("unpaid", "未繳費"), ("semester", "學期會籍（500 元）"), ("lifetime", "在學會籍（1,000 元）")]
FILTERS = [("", "（全部）"), ("unpaid", "未繳社費"), ("paid", "已繳社費"), ("voting", "具表決權"),
           ("unbound", "未綁定帳號"), ("trial", "非正式社員"), ("member", "正式社員"),
           ("prep", "籌備幹部"), ("officer", "正式幹部")]
FEE_TYPES = [("", "依金額自動判斷"), ("semester", "學期會籍"), ("lifetime", "在學會籍"), ("other", "其他")]
FEE_TYPE_LABELS = {"semester": "學期會籍", "lifetime": "在學會籍", "other": "其他"}
# CSV column names accepted by 匯入 CSV (the server also accepts its own field names).
IMPORT_HEADERS = {"姓名": "name", "學號": "studentId", "email": "email", "電話": "phone", "職務": "position",
                  "加入日期": "joinedAt", "身分": "level", "社員身分": "level", "社費": "feeStatus",
                  "社費狀態": "feeStatus", "會籍學期": "feeSemester", "備註": "note",
                  "studentid": "studentId", "joinedat": "joinedAt", "feestatus": "feeStatus",
                  "feesemester": "feeSemester", "name": "name", "phone": "phone", "position": "position",
                  "level": "level", "note": "note"}


def semester_of(day: date) -> str:
    """Same rule as semesterOf() in src/membership.js (ROC academic term)."""
    if day.month >= 8:
        return f"{day.year - 1911}-1"
    return f"{day.year - 1912}-{1 if day.month == 1 else 2}"


def combo(items, current="") -> QComboBox:
    box = QComboBox()
    for key, label in items:
        box.addItem(label, key)
    index = box.findData(current)
    box.setCurrentIndex(max(index, 0))
    return box


def date_edit(value: str = "", allow_empty=False) -> QDateEdit:
    edit = QDateEdit()
    edit.setCalendarPopup(True)
    edit.setDisplayFormat("yyyy-MM-dd")
    if allow_empty:
        edit.setMinimumDate(QDate(1999, 12, 31))
        edit.setSpecialValueText("（未填）")
    parsed = QDate.fromString(value[:10], "yyyy-MM-dd") if value else QDate()
    edit.setDate(parsed if parsed.isValid() else (edit.minimumDate() if allow_empty and not value else QDate.currentDate()))
    return edit


def date_text(edit: QDateEdit) -> str:
    return "" if edit.date() == edit.minimumDate() and edit.specialValueText() else edit.date().toString("yyyy-MM-dd")


def dialog_buttons(dialog: QDialog) -> QDialogButtonBox:
    buttons = QDialogButtonBox()
    buttons.addButton("確定", QDialogButtonBox.AcceptRole)
    buttons.addButton("取消", QDialogButtonBox.RejectRole)
    buttons.accepted.connect(dialog.accept)
    buttons.rejected.connect(dialog.reject)
    return buttons


class MemberDialog(QDialog):
    def __init__(self, parent, member: dict | None = None):
        super().__init__(parent)
        member = member or {}
        self.setWindowTitle("修改社員資料" if member else "新增社員")
        self.name = QLineEdit(member.get("name", ""))
        self.student_id = QLineEdit(member.get("studentId", ""))
        self.email = QLineEdit(member.get("email", ""))
        self.phone = QLineEdit(member.get("phone", ""))
        self.position = QLineEdit(member.get("position", ""))
        self.level = combo(LEVELS, member.get("level", "member"))
        self.fee = combo(FEES, member.get("feeStatus", "unpaid"))
        self.fee_semester = QLineEdit(member.get("feeSemester", ""))
        self.fee_semester.setPlaceholderText(f"例如 {semester_of(date.today())}")
        self.joined = date_edit(member.get("joinedAt", ""), allow_empty=bool(member))
        self.trial = QSpinBox()
        self.trial.setRange(0, 99)
        self.trial.setValue(int(member.get("trialUses") or 0))
        self.note = QPlainTextEdit(member.get("note", ""))
        self.note.setFixedHeight(60)
        self.fee.currentIndexChanged.connect(self.fee_changed)
        self.fee_changed()

        basic = QGroupBox("基本資料")
        form = QFormLayout(basic)
        form.addRow("姓名：", self.name)
        form.addRow("學號：", self.student_id)
        form.addRow("Email：", self.email)
        form.addRow("電話：", self.phone)
        form.addRow("職務：", self.position)
        form.addRow("加入日期：", self.joined)
        status = QGroupBox("社籍與社費")
        form2 = QFormLayout(status)
        form2.addRow("社員身分：", self.level)
        form2.addRow("社費狀態：", self.fee)
        form2.addRow("會籍學期：", self.fee_semester)
        form2.addRow("體驗社課次數：", self.trial)
        layout = QVBoxLayout(self)
        layout.addWidget(basic)
        layout.addWidget(status)
        layout.addWidget(QLabel("備註："))
        layout.addWidget(self.note)
        layout.addWidget(dialog_buttons(self))
        self.setMinimumWidth(380)

    def fee_changed(self) -> None:
        semester = self.fee.currentData() == "semester"
        self.fee_semester.setEnabled(semester)
        if semester and not self.fee_semester.text():
            self.fee_semester.setText(semester_of(date.today()))

    def accept(self) -> None:
        if not self.name.text().strip() and not self.student_id.text().strip():
            QMessageBox.warning(self, "資料不完整", "請至少填寫姓名或學號。")
            return
        super().accept()

    def values(self) -> dict:
        return {
            "name": self.name.text().strip(), "studentId": self.student_id.text().strip(),
            "email": self.email.text().strip(), "phone": self.phone.text().strip(),
            "position": self.position.text().strip(), "joinedAt": date_text(self.joined),
            "level": self.level.currentData(), "feeStatus": self.fee.currentData(),
            "feeSemester": self.fee_semester.text().strip() if self.fee.currentData() == "semester" else "",
            "trialUses": self.trial.value(), "note": self.note.toPlainText().strip(),
        }


class BulkDialog(QDialog):
    def __init__(self, parent, count: int):
        super().__init__(parent)
        self.setWindowTitle("批次修改")
        self.level = combo([("", "（不變更）")] + LEVELS)
        self.fee = combo([("", "（不變更）")] + FEES)
        self.fee_semester = QLineEdit(semester_of(date.today()))
        form = QFormLayout()
        form.addRow("社員身分：", self.level)
        form.addRow("社費狀態：", self.fee)
        form.addRow("會籍學期：", self.fee_semester)
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel(f"已選取 {count} 位社員，請選擇要修改的項目："))
        layout.addLayout(form)
        layout.addWidget(dialog_buttons(self))

    def values(self) -> dict:
        changes = {}
        if self.level.currentData():
            changes["level"] = self.level.currentData()
        if self.fee.currentData():
            changes["feeStatus"] = self.fee.currentData()
            changes["feeSemester"] = self.fee_semester.text().strip() if self.fee.currentData() == "semester" else ""
        return changes


class MembersPage(Page):
    title = "社員名冊"
    export_name = "社員名冊.csv"

    def __init__(self, *args):
        super().__init__(*args)
        search = QGroupBox("查詢條件")
        row = QHBoxLayout(search)
        self.query = QLineEdit()
        self.query.setPlaceholderText("姓名、學號、Email、電話、職務、備註")
        self.query.returnPressed.connect(self.safe_refresh)
        self.filter = combo(FILTERS)
        find = QPushButton("查詢(&Q)")
        find.clicked.connect(self.safe_refresh)
        clear = QPushButton("清除")
        clear.clicked.connect(self.clear_search)
        row.addWidget(QLabel("關鍵字："))
        row.addWidget(self.query, 1)
        row.addWidget(QLabel("篩選："))
        row.addWidget(self.filter)
        row.addWidget(find)
        row.addWidget(clear)
        self.body.addWidget(search)

        self.table = DataTable([
            ("學號", "studentId"), ("姓名", "name"),
            ("身分", lambda m: m.get("status", {}).get("levelLabel", "")),
            ("社費", lambda m: m.get("status", {}).get("feeLabel", "")),
            ("表決權", lambda m: "有" if m.get("status", {}).get("voting") else "無"),
            ("職務", "position"), ("Email", "email"), ("電話", "phone"),
            ("加入日期", "joinedAt"), ("登入帳號", "account"), ("備註", "note"),
        ], multi=True)
        self.table.doubleClicked.connect(self.edit)
        self.body.addWidget(self.table, 1)

        add = QPushButton("新增(&N)...")
        add.clicked.connect(self.add)
        edit = QPushButton("修改(&E)...")
        edit.clicked.connect(self.edit)
        bulk = QPushButton("批次修改(&B)...")
        bulk.clicked.connect(self.bulk)
        remove = QPushButton("刪除(&D)")
        remove.clicked.connect(self.remove)
        select_all = QPushButton("全選(&A)")
        select_all.clicked.connect(self.table.selectAll)
        imp = QPushButton("匯入 CSV(&I)...")
        imp.clicked.connect(self.import_csv)
        self.body.addLayout(button_row(add, edit, bulk, remove, select_all, imp))

    def clear_search(self) -> None:
        self.query.clear()
        self.filter.setCurrentIndex(0)
        self.safe_refresh()

    def refresh(self) -> None:
        rows = self.api.members(self.query.text().strip(), self.filter.currentData())
        rows.sort(key=lambda m: (m.get("studentId") or "~", m.get("name") or ""))
        self.table.set_rows(rows)
        unpaid = sum(1 for m in rows if m.get("status", {}).get("unpaid"))
        self.status(f"社員 {len(rows)} 人，未繳社費 {unpaid} 人")

    def run(self, action, done_message: str = "") -> bool:
        try:
            with busy():
                result = action()
        except ApiError as error:
            show_error(self, error)
            return False
        if done_message:
            self.status(done_message.format(result=result) if isinstance(result, dict) else done_message)
        self.safe_refresh()
        return True

    def add(self) -> None:
        dialog = MemberDialog(self)
        if dialog.exec() == QDialog.Accepted:
            self.run(lambda: self.api.create_member(dialog.values()), "已新增社員")

    def edit(self) -> None:
        member = self.table.current_row_data()
        if not member:
            QMessageBox.information(self, "修改", "請先選取一位社員。")
            return
        dialog = MemberDialog(self, member)
        if dialog.exec() == QDialog.Accepted:
            self.run(lambda: self.api.update_member(member["id"], dialog.values()), "已儲存社員資料")

    def bulk(self) -> None:
        selected = self.table.selected_rows()
        if not selected:
            QMessageBox.information(self, "批次修改", "請先選取社員（可按「全選」或按住 Ctrl 點選）。")
            return
        dialog = BulkDialog(self, len(selected))
        if dialog.exec() != QDialog.Accepted:
            return
        changes = dialog.values()
        if not changes:
            QMessageBox.information(self, "批次修改", "沒有選擇要修改的項目。")
            return
        self.run(lambda: self.api.bulk_members([m["id"] for m in selected], **changes),
                 "已批次修改 {result[updated]} 位社員")

    def remove(self) -> None:
        selected = self.table.selected_rows()
        if not selected:
            QMessageBox.information(self, "刪除", "請先選取要刪除的社員。")
            return
        names = "、".join(m.get("name") or m.get("studentId") or "?" for m in selected[:5])
        more = f" 等 {len(selected)} 人" if len(selected) > 5 else ""
        if not confirm(self, f"確定要刪除 {names}{more}？\n綁定的登入帳號會一併解除綁定，此動作無法復原。"):
            return
        if len(selected) == 1:
            self.run(lambda: self.api.delete_member(selected[0]["id"]), "已刪除社員")
        else:
            self.run(lambda: self.api.bulk_members([m["id"] for m in selected], action="delete"),
                     "已刪除 {result[deleted]} 位社員")

    def import_csv(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "匯入社員名冊", "", "CSV 檔案 (*.csv)")
        if not path:
            return
        try:
            with open(path, newline="", encoding="utf-8-sig") as handle:
                rows = [{IMPORT_HEADERS.get(k.strip().lower(), k.strip()): (v or "").strip()
                         for k, v in row.items() if k} for row in csv.DictReader(handle)]
        except (OSError, UnicodeDecodeError, csv.Error) as error:
            show_error(self, ApiError(f"無法讀取 CSV：{error}"))
            return
        rows = [r for r in rows if r.get("name") or r.get("studentId")]
        if not rows:
            QMessageBox.warning(self, "匯入", "檔案中沒有可匯入的資料。第一列需為欄位名稱，例如：姓名,學號,Email,電話")
            return
        if not confirm(self, f"即將匯入 {len(rows)} 筆資料，學號或姓名重複者會略過。是否繼續？"):
            return
        try:
            with busy():
                result = self.api.import_members(rows[:500])
        except ApiError as error:
            show_error(self, error)
            return
        QMessageBox.information(self, "匯入完成", f"已匯入 {result['imported']} 筆，略過重複 {result['skipped']} 筆。")
        self.safe_refresh()


class ReceiptDialog(QDialog):
    def __init__(self, parent, members: list[dict], receiver: str):
        super().__init__(parent)
        self.setWindowTitle("登錄社費簽收")
        self.member = QComboBox()
        self.member.addItem("（不指定，手動填寫）", "")
        for m in sorted(members, key=lambda m: m.get("studentId") or ""):
            self.member.addItem(f"{m.get('studentId', '')} {m.get('name', '')}".strip(), m["id"])
        self.member.setEditable(True)
        self.member.setInsertPolicy(QComboBox.NoInsert)
        self.payer = QLineEdit()
        self.student_id = QLineEdit()
        self.amount = QSpinBox()
        self.amount.setRange(1, 1_000_000)
        self.amount.setValue(500)
        self.amount.setSuffix(" 元")
        self.fee_type = combo(FEE_TYPES)
        self.day = date_edit()
        self.receiver = QLineEdit(receiver)
        self.number = QLineEdit()
        self.note = QLineEdit()
        self.member.currentIndexChanged.connect(self.member_changed)
        form = QFormLayout()
        form.addRow("社員：", self.member)
        form.addRow("繳費者姓名：", self.payer)
        form.addRow("學號：", self.student_id)
        form.addRow("金額：", self.amount)
        form.addRow("會籍類別：", self.fee_type)
        form.addRow("繳費日期：", self.day)
        form.addRow("收款人：", self.receiver)
        form.addRow("收據編號：", self.number)
        form.addRow("備註：", self.note)
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(QLabel("指定社員後，系統會依金額自動更新該社員的社費狀態。"))
        layout.addWidget(dialog_buttons(self))
        self.setMinimumWidth(380)

    def member_changed(self) -> None:
        manual = not self.member.currentData()
        self.payer.setEnabled(manual)
        self.student_id.setEnabled(manual)

    def accept(self) -> None:
        if not self.member.currentData() and not (self.payer.text().strip() or self.student_id.text().strip()):
            QMessageBox.warning(self, "資料不完整", "請選擇社員，或填寫繳費者姓名或學號。")
            return
        if not self.receiver.text().strip():
            QMessageBox.warning(self, "資料不完整", "請填寫收款人。")
            return
        super().accept()

    def values(self) -> dict:
        values = {"memberId": self.member.currentData() or "", "amount": self.amount.value(),
                  "date": date_text(self.day), "receiver": self.receiver.text().strip(),
                  "receiptNumber": self.number.text().strip(), "note": self.note.text().strip()}
        if self.fee_type.currentData():
            values["feeType"] = self.fee_type.currentData()
        if not values["memberId"]:
            values["payerName"] = self.payer.text().strip()
            values["studentId"] = self.student_id.text().strip()
        return values


class FeeReceiptsPage(Page):
    title = "社費簽收紀錄"
    export_name = "社費簽收紀錄.csv"

    def __init__(self, *args):
        super().__init__(*args)
        self.table = DataTable([
            ("繳費日期", "date"), ("學期", "semester"), ("學號", "studentId"), ("繳費者", "payerName"),
            ("金額", lambda r: money(r.get("amount")), "right"),
            ("類別", lambda r: FEE_TYPE_LABELS.get(r.get("feeType"), "")),
            ("收款人", "receiver"), ("收據編號", "receiptNumber"), ("登錄者", "recordedBy"), ("備註", "note"),
        ])
        self.body.addWidget(self.table, 1)
        self.total = QLabel()
        self.total.setObjectName("Total")
        add = QPushButton("登錄簽收(&N)...")
        add.clicked.connect(self.add)
        remove = QPushButton("刪除(&D)")
        remove.clicked.connect(self.remove)
        refresh = QPushButton("重新整理")
        refresh.clicked.connect(self.safe_refresh)
        row = button_row(add, remove, refresh)
        row.addWidget(QLabel("本學期合計："))
        row.addWidget(self.total)
        self.body.addLayout(row)

    def refresh(self) -> None:
        rows = self.api.fee_receipts()
        self.table.set_rows(rows)
        current = semester_of(date.today())
        total = sum(r.get("amount", 0) for r in rows if r.get("semester") == current)
        self.total.setText(f"{current} 學期　NT$ {money(total)}")
        self.status(f"簽收紀錄 {len(rows)} 筆")

    def add(self) -> None:
        try:
            with busy():
                members = self.api.members()
        except ApiError as error:
            show_error(self, error)
            return
        dialog = ReceiptDialog(self, members, self.user.get("username", ""))
        if dialog.exec() != QDialog.Accepted:
            return
        try:
            with busy():
                record = self.api.create_fee_receipt(dialog.values())
        except ApiError as error:
            show_error(self, error)
            return
        status = record.get("memberStatus")
        if status:
            QMessageBox.information(self, "登錄完成", f"已登錄簽收。社員目前狀態：{status.get('levelLabel')}／{status.get('feeLabel')}")
        self.safe_refresh()

    def remove(self) -> None:
        record = self.table.current_row_data()
        if not record:
            QMessageBox.information(self, "刪除", "請先選取一筆簽收紀錄。")
            return
        if not confirm(self, f"確定要刪除 {record.get('date')} {record.get('payerName')} 的簽收紀錄？\n（社員的社費狀態不會自動改回）"):
            return
        try:
            with busy():
                self.api.delete_fee_receipt(record["id"])
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()
