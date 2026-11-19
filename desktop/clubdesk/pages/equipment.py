"""器材清冊 page."""

from __future__ import annotations

from PySide6.QtWidgets import (QDialog, QFormLayout, QGroupBox, QHBoxLayout, QLabel, QLineEdit,
                               QMessageBox, QPlainTextEdit, QPushButton, QSpinBox, QVBoxLayout)

from ..api import ApiError
from ..widgets import DataTable, Page, busy, button_row, money, show_error
from .members import combo, date_edit, date_text, dialog_buttons

CONDITIONS = [("good", "良好"), ("fair", "尚可"), ("poor", "不佳")]
STATUSES = [("storage", "庫存"), ("in_use", "使用中"), ("repair", "維修中"), ("retired", "已報廢")]
CONDITION_LABELS = dict(CONDITIONS)
STATUS_LABELS = dict(STATUSES)


class EquipmentDialog(QDialog):
    def __init__(self, parent, asset: dict | None = None):
        super().__init__(parent)
        asset = asset or {}
        self.setWindowTitle(f"修改器材 {asset.get('assetNo', '')}" if asset else "新增器材")
        self.name = QLineEdit(asset.get("assetName", ""))
        self.category = QLineEdit(asset.get("category", ""))
        self.category.setPlaceholderText("例如 空拍機、穿越機、電池、遙控器")
        self.serial = QLineEdit(asset.get("serialNo", ""))
        self.purchase_date = date_edit(asset.get("purchaseDate", ""), allow_empty=True)
        self.price = QSpinBox()
        self.price.setRange(0, 1_000_000_000)
        self.price.setGroupSeparatorShown(True)
        self.price.setSuffix(" 元")
        self.price.setValue(int(asset.get("purchasePrice") or 0))
        self.condition = combo(CONDITIONS, asset.get("condition", "good"))
        self.state = combo(STATUSES, asset.get("status", "storage"))
        self.location = QLineEdit(asset.get("location", ""))
        self.custodian = QLineEdit(asset.get("custodian", ""))
        self.note = QPlainTextEdit(asset.get("note", ""))
        self.note.setFixedHeight(60)
        form = QFormLayout()
        form.addRow("器材名稱：", self.name)
        form.addRow("類別：", self.category)
        form.addRow("原廠序號：", self.serial)
        form.addRow("購入日期：", self.purchase_date)
        form.addRow("購入金額：", self.price)
        form.addRow("狀況：", self.condition)
        form.addRow("狀態：", self.state)
        form.addRow("存放位置：", self.location)
        form.addRow("保管人：", self.custodian)
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(QLabel("備註："))
        layout.addWidget(self.note)
        layout.addWidget(dialog_buttons(self))
        self.setMinimumWidth(380)

    def accept(self) -> None:
        if not self.name.text().strip():
            QMessageBox.warning(self, "資料不完整", "請填寫器材名稱。")
            return
        super().accept()

    def values(self) -> dict:
        return {"assetName": self.name.text().strip(), "category": self.category.text().strip(),
                "serialNo": self.serial.text().strip(), "purchaseDate": date_text(self.purchase_date),
                "purchasePrice": self.price.value(), "condition": self.condition.currentData(),
                "status": self.state.currentData(), "location": self.location.text().strip(),
                "custodian": self.custodian.text().strip(), "note": self.note.toPlainText().strip()}


class EquipmentPage(Page):
    title = "器材清冊"
    icon_name = "equipment"
    export_name = "器材清冊.csv"

    def __init__(self, *args):
        super().__init__(*args)
        search = QGroupBox("查詢條件")
        row = QHBoxLayout(search)
        self.query = QLineEdit()
        self.query.setPlaceholderText("財產編號、名稱、類別、序號、位置、保管人")
        self.query.returnPressed.connect(self.safe_refresh)
        find = QPushButton("查詢(&Q)")
        find.clicked.connect(self.safe_refresh)
        row.addWidget(QLabel("關鍵字："))
        row.addWidget(self.query, 1)
        row.addWidget(find)
        self.body.addWidget(search)
        self.table = DataTable([
            ("財產編號", "assetNo"), ("器材名稱", "assetName"), ("類別", "category"), ("原廠序號", "serialNo"),
            ("狀態", lambda a: STATUS_LABELS.get(a.get("status"), "")),
            ("狀況", lambda a: CONDITION_LABELS.get(a.get("condition"), "")),
            ("存放位置", "location"), ("保管人", "custodian"), ("購入日期", "purchaseDate"),
            ("購入金額", lambda a: money(a.get("purchasePrice")), "right"), ("備註", "note"),
        ])
        self.table.doubleClicked.connect(self.edit)
        self.body.addWidget(self.table, 1)
        add = QPushButton("新增(&N)...")
        add.clicked.connect(self.add)
        edit = QPushButton("修改(&E)...")
        edit.clicked.connect(self.edit)
        self.body.addLayout(button_row(add, edit))

    def refresh(self) -> None:
        rows = self.api.equipment(self.query.text().strip())
        rows.sort(key=lambda a: a.get("assetNo", ""))
        self.table.set_rows(rows)
        value = sum(a.get("purchasePrice") or 0 for a in rows if a.get("status") != "retired")
        self.status(f"器材 {len(rows)} 件，在帳價值 NT$ {money(value)}")

    def save(self, action) -> None:
        try:
            with busy():
                action()
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()

    def add(self) -> None:
        dialog = EquipmentDialog(self)
        if dialog.exec() == QDialog.Accepted:
            self.save(lambda: self.api.create_equipment(dialog.values()))

    def edit(self) -> None:
        asset = self.table.current_row_data()
        if not asset:
            QMessageBox.information(self, "修改", "請先選取一件器材。")
            return
        dialog = EquipmentDialog(self, asset)
        if dialog.exec() == QDialog.Accepted:
            self.save(lambda: self.api.update_equipment(asset["id"], dialog.values()))
