"""表單作業 page: paper forms with AI 協助填寫 and AI 公文產生, printed through the browser."""

from __future__ import annotations

import os
import re
import tempfile

from PySide6.QtCore import QDate, Qt, QUrl
from PySide6.QtGui import QDesktopServices, QIntValidator
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDateEdit, QDialog, QFormLayout,
                               QGridLayout, QGroupBox, QHBoxLayout, QInputDialog, QLabel, QLineEdit, QMenu,
                               QMessageBox, QPlainTextEdit, QPushButton, QScrollArea, QTableWidget,
                               QTableWidgetItem, QTabWidget, QVBoxLayout, QWidget)

from ..api import ApiError, can_manage_users
from ..formschema import FORM_LABELS, FORM_TYPES, SCHEMAS, Field, defaults, items_total
from ..widgets import DataTable, Page, busy, button_row, confirm, money, show_error
from .members import dialog_buttons

TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def kind_of(field_or_kind) -> str:
    kind = field_or_kind.kind if isinstance(field_or_kind, Field) else field_or_kind
    return kind.split(":")[0]


def max_length(kind: str, default=100) -> int:
    return int(kind.split(":")[1]) if ":" in kind else default


class ItemsTable(QWidget):
    """Editable grid for 支出明細 / 借用設備."""

    def __init__(self, columns, max_rows: int, show_total: bool):
        super().__init__()
        self.columns, self.max_rows = columns, max_rows
        self.grid = QTableWidget(0, len(columns))
        self.grid.setHorizontalHeaderLabels([label for _, label, _ in columns])
        self.grid.horizontalHeader().setStretchLastSection(True)
        self.grid.verticalHeader().setDefaultSectionSize(20)
        self.grid.setMinimumHeight(160)
        add = QPushButton("新增一列")
        add.clicked.connect(lambda: self.add_row({}))
        remove = QPushButton("刪除此列")
        remove.clicked.connect(lambda: self.grid.removeRow(self.grid.currentRow()))
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self.grid)
        row = button_row(add, remove)
        self.total = QLabel()
        if show_total:
            row.addWidget(QLabel("合計："))
            self.total.setObjectName("Total")
            row.addWidget(self.total)
            self.grid.itemChanged.connect(self.update_total)
        layout.addLayout(row)
        layout.addWidget(QLabel(f"最多 {max_rows} 列。日期格式 YYYY-MM-DD，數量與金額請填整數。"))

    def add_row(self, values: dict) -> None:
        if self.grid.rowCount() >= self.max_rows:
            QMessageBox.information(self, "明細", f"最多只能填 {self.max_rows} 列。")
            return
        r = self.grid.rowCount()
        self.grid.insertRow(r)
        for c, (key, _, kind) in enumerate(self.columns):
            value = values.get(key)
            self.grid.setItem(r, c, QTableWidgetItem("" if value is None else str(value)))
            if kind == "int":
                self.grid.item(r, c).setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.update_total()

    def set_value(self, rows) -> None:
        self.grid.setRowCount(0)
        for row in rows or []:
            self.add_row(row)

    def value(self) -> list[dict]:
        rows = []
        for r in range(self.grid.rowCount()):
            row = {}
            for c, (key, label, kind) in enumerate(self.columns):
                text = (self.grid.item(r, c).text() if self.grid.item(r, c) else "").strip()
                if kind == "int":
                    text = text.replace(",", "")
                    if text and not re.fullmatch(r"\d+", text):
                        raise ValueError(f"第 {r + 1} 列「{label}」必須是整數")
                    row[key] = int(text) if text else None
                else:
                    row[key] = text
            if any(v not in ("", None) for v in row.values()):
                rows.append(row)
        return rows

    def update_total(self, *_):
        if not self.total.objectName():
            return
        try:
            self.total.setText(f"NT$ {money(items_total(self.value()))}")
        except ValueError:
            self.total.setText("—")


class FormEditor(QDialog):
    def __init__(self, parent, api, form_type: str, record: dict | None, ai_ready: bool):
        super().__init__(parent)
        self.api, self.form_type, self.record = api, form_type, record
        number = f"（{record.get('number')}）" if record and record.get("number") else ""
        self.setWindowTitle(f"{'修改' if record else '填寫'}{FORM_LABELS[form_type]}{number}")
        self.fields = SCHEMAS[form_type]
        self.widgets: dict[str, QWidget] = {}

        tabs = QTabWidget()
        groups: dict[str, QFormLayout] = {}
        for field in self.fields:
            if field.group not in groups:
                page = QWidget()
                form = QFormLayout(page)
                form.setFieldGrowthPolicy(QFormLayout.ExpandingFieldsGrow)
                scroll = QScrollArea()
                scroll.setWidgetResizable(True)
                scroll.setWidget(page)
                tabs.addTab(scroll, field.group or "資料")
                groups[field.group] = form
            widget = self.make_widget(field)
            self.widgets[field.key] = widget
            label = field.label + ("＊" if field.required else "") + "："
            groups[field.group].addRow(label, widget)

        ai_row = QHBoxLayout()
        fill = QPushButton("AI 協助填寫(&I)...")
        fill.clicked.connect(self.ai_fill)
        ai_row.addWidget(fill)
        if form_type == "official-letter":
            letter = QPushButton("AI 白話轉公文(&W)...")
            letter.clicked.connect(self.ai_letter)
            ai_row.addWidget(letter)
        ai_row.addStretch(1)
        ai_row.addWidget(QLabel("＊為必填"))
        self.ai_buttons = [ai_row.itemAt(i).widget() for i in range(ai_row.count()) if isinstance(ai_row.itemAt(i).widget(), QPushButton)]
        for button in self.ai_buttons:
            button.setEnabled(ai_ready)
            if not ai_ready:
                button.setToolTip("網站尚未設定 AI 金鑰（GROQ_API_KEY 或 GEMINI_API_KEY）")

        layout = QVBoxLayout(self)
        layout.addLayout(ai_row)
        layout.addWidget(tabs, 1)
        layout.addWidget(dialog_buttons(self))
        self.resize(620, 560)
        self.set_values(record.get("data", {}) if record else defaults(form_type))

    # -------------------------------------------------------------- widgets
    def make_widget(self, field: Field) -> QWidget:
        kind = kind_of(field)
        if kind == "text":
            widget = QLineEdit()
            widget.setMaxLength(max_length(field.kind))
        elif kind in ("memo", "lines"):
            widget = QPlainTextEdit()
            widget.setFixedHeight(110 if kind == "lines" or max_length(field.kind) > 500 else 60)
        elif kind == "date":
            widget = QDateEdit()
            widget.setCalendarPopup(True)
            widget.setDisplayFormat("yyyy-MM-dd")
            if not field.required:
                widget.setMinimumDate(QDate(1999, 12, 31))
                widget.setSpecialValueText("（未填）")
        elif kind == "time":
            widget = QLineEdit()
            widget.setPlaceholderText("HH:MM，例如 13:30")
            widget.setMaxLength(5)
        elif kind == "int":
            widget = QLineEdit()
            low, high = field.options or (0, 1_000_000_000)
            widget.setValidator(QIntValidator(low, min(high, 2_000_000_000)))
            widget.setMaximumWidth(140)
        elif kind == "bool":
            widget = QCheckBox()
        elif kind == "enum":
            widget = QComboBox()
            for value, label in field.options:
                widget.addItem(label, value)
        elif kind == "multi":
            widget = QWidget()
            grid = QGridLayout(widget)
            grid.setContentsMargins(0, 0, 0, 0)
            widget.boxes = []
            for i, option in enumerate(field.options):
                box = QCheckBox(option)
                grid.addWidget(box, i // 3, i % 3)
                widget.boxes.append(box)
        elif kind == "items":
            columns, max_rows = field.options
            widget = ItemsTable(columns, max_rows, show_total=self.form_type.startswith("expense"))
        else:
            raise ValueError(kind)
        return widget

    def set_values(self, values: dict, only_given=False) -> None:
        for field in self.fields:
            if only_given and field.key not in values:
                continue
            self.set_value(field, values.get(field.key))

    def set_value(self, field: Field, value) -> None:
        widget, kind = self.widgets[field.key], kind_of(field)
        if kind in ("text", "time"):
            widget.setText("" if value is None else str(value))
        elif kind == "memo":
            widget.setPlainText("" if value is None else str(value))
        elif kind == "lines":
            widget.setPlainText("\n".join(value or []))
        elif kind == "date":
            parsed = QDate.fromString(str(value or "")[:10], "yyyy-MM-dd")
            widget.setDate(parsed if parsed.isValid() else (widget.minimumDate() if widget.specialValueText() else QDate.currentDate()))
        elif kind == "int":
            widget.setText("" if value in (None, "") else str(value))
        elif kind == "bool":
            widget.setChecked(value is True)
        elif kind == "enum":
            index = widget.findData(value)
            widget.setCurrentIndex(index if index >= 0 else 0)
        elif kind == "multi":
            chosen = set(value or [])
            for box in widget.boxes:
                box.setChecked(box.text() in chosen)
        elif kind == "items":
            widget.set_value(value)

    def values(self) -> dict:
        """Collects the form; raises ValueError with a message the user can act on."""
        data = {}
        for field in self.fields:
            widget, kind = self.widgets[field.key], kind_of(field)
            if kind == "text":
                value = widget.text().strip()
            elif kind == "memo":
                value = widget.toPlainText().strip()
            elif kind == "lines":
                value = [line.strip() for line in widget.toPlainText().splitlines() if line.strip()]
            elif kind == "date":
                empty = widget.specialValueText() and widget.date() == widget.minimumDate()
                value = "" if empty else widget.date().toString("yyyy-MM-dd")
            elif kind == "time":
                value = widget.text().strip()
                if value and not TIME_PATTERN.match(value):
                    raise ValueError(f"「{field.label}」格式必須為 HH:MM")
            elif kind == "int":
                value = int(widget.text()) if widget.text().strip() else None
            elif kind == "bool":
                value = widget.isChecked()
            elif kind == "enum":
                value = widget.currentData()
            elif kind == "multi":
                value = [box.text() for box in widget.boxes if box.isChecked()]
            else:
                value = widget.value()
            if field.required and value in ("", None, []):
                raise ValueError(f"請填寫「{field.label}」")
            data[field.key] = value
        if data.get("category") == "other" and not data.get("categoryOther"):
            raise ValueError("支出類別為「其他」時，請填寫其他類別說明")
        return data

    def accept(self) -> None:
        try:
            self.data = self.values()
        except ValueError as error:
            QMessageBox.warning(self, "資料不完整", str(error))
            return
        super().accept()

    # ------------------------------------------------------------------- AI
    def ai_fill(self) -> None:
        text, ok = QInputDialog.getMultiLineText(
            self, "AI 協助填寫",
            "請用口語描述要填的內容，AI 會整理成表單欄位，您確認後再儲存。\n"
            "例如：「我王小明，機械三，下週六要借兩台 Mini 4 Pro 去操場練習，週日歸還。」")
        if not ok or not text.strip():
            return
        try:
            with busy():
                result = self.api.ai_fill(self.form_type, text.strip()[:4000])
        except ApiError as error:
            show_error(self, error, "AI 協助填寫")
            return
        fields = result.get("fields") or {}
        self.set_values(fields, only_given=True)
        filled = [f.label for f in self.fields if f.key in fields]
        message = f"AI 已填入 {len(filled)} 個欄位：{'、'.join(filled) or '（無）'}"
        if result.get("notes"):
            message += f"\n\n提醒：{result['notes']}"
        message += "\n\n請逐一確認內容是否正確後再按「確定」。"
        QMessageBox.information(self, "AI 協助填寫", message)

    def ai_letter(self) -> None:
        doc_type = self.widgets["docType"].currentData()
        text, ok = QInputDialog.getMultiLineText(
            self, "AI 白話轉公文",
            f"請用白話寫下要表達的事情，AI 會改寫成「{doc_type}」的主旨與說明：")
        if not ok or not text.strip():
            return
        try:
            with busy():
                draft = self.api.ai_letter(text.strip()[:4000], doc_type)
        except ApiError as error:
            show_error(self, error, "AI 白話轉公文")
            return
        self.set_values({"subject": draft.get("subject", ""), "descriptions": draft.get("descriptions", [])}, only_given=True)
        QMessageBox.information(self, "AI 白話轉公文", "已填入主旨與說明，請確認用語後再按「確定」。")


class SettingsDialog(QDialog):
    KEYS = [("clubName", "社團全名"), ("clubShortName", "社團簡稱"), ("presidentName", "社長姓名"),
            ("propertyManager", "財產管理人"), ("advisorName", "指導老師")]

    def __init__(self, parent, settings: dict):
        super().__init__(parent)
        self.setWindowTitle("表單設定")
        form = QFormLayout(self)
        self.edits = {}
        for key, label in self.KEYS:
            edit = QLineEdit(settings.get(key, ""))
            edit.setMaxLength(50)
            self.edits[key] = edit
            form.addRow(label + "：", edit)
        form.addRow(QLabel("這些名稱會印在每一張表單上。"))
        form.addRow(dialog_buttons(self))

    def values(self) -> dict:
        return {key: edit.text().strip() for key, edit in self.edits.items()}


class FormsPage(Page):
    title = "表單作業"
    icon_name = "forms"
    export_name = "表單紀錄.csv"

    def __init__(self, *args):
        super().__init__(*args)
        self.settings: dict = {}
        top = QGroupBox("查詢條件")
        row = QHBoxLayout(top)
        self.type_filter = QComboBox()
        self.type_filter.addItem("（全部表單）", "")
        for key, label in FORM_TYPES:
            self.type_filter.addItem(label, key)
        self.type_filter.currentIndexChanged.connect(self.safe_refresh)
        row.addWidget(QLabel("表單類型："))
        row.addWidget(self.type_filter)
        row.addStretch(1)
        self.ai_status = QLabel()
        row.addWidget(self.ai_status)
        self.body.addWidget(top)

        self.table = DataTable([
            ("編號", "number"), ("類型", lambda r: FORM_LABELS.get(r.get("type"), r.get("type"))),
            ("標題", "title"), ("填表人", lambda r: r.get("createdBy") or ("線上借用" if r.get("source") == "public" else "")),
            ("建立時間", lambda r: (r.get("createdAt") or "")[:16].replace("T", " ")),
            ("最後修改", lambda r: (r.get("updatedAt") or "")[:16].replace("T", " ")),
        ])
        self.table.doubleClicked.connect(self.edit)
        self.body.addWidget(self.table, 1)

        new = QPushButton("填寫新表單(&N)")
        new_menu = QMenu(new)
        blank = QPushButton("列印空白表單")
        blank_menu = QMenu(blank)
        for key, label in FORM_TYPES:
            new_menu.addAction(label, lambda k=key: self.add(k))
            blank_menu.addAction(label, lambda k=key: self.print_page(blank_type=k))
        new.setMenu(new_menu)
        blank.setMenu(blank_menu)
        edit = QPushButton("修改(&E)...")
        edit.clicked.connect(self.edit)
        remove = QPushButton("刪除(&D)")
        remove.clicked.connect(self.remove)
        print_button = QPushButton("列印(&P)...")
        print_button.clicked.connect(self.print_selected)
        settings = QPushButton("表單設定(&S)...")
        settings.clicked.connect(self.edit_settings)
        settings.setEnabled(can_manage_users(self.role))
        self.body.addLayout(button_row(new, edit, remove, print_button, blank, settings))
        self.body.addWidget(QLabel("列印時會以瀏覽器開啟 A4 表單，請在瀏覽器按「列印／另存 PDF」。審核與簽名仍在紙本上進行。"))

    @property
    def ai_ready(self) -> bool:
        return bool(self.settings.get("ai"))

    def refresh(self) -> None:
        self.settings = self.api.form_settings()
        ai = self.settings.get("ai")
        self.ai_status.setText(f"AI：已啟用（{ai.get('provider')}／{ai.get('model')}）" if ai else "AI：未設定")
        rows = self.api.forms(self.type_filter.currentData())
        self.table.set_rows(rows)
        self.status(f"表單 {len(rows)} 筆")

    def add(self, form_type: str) -> None:
        dialog = FormEditor(self, self.api, form_type, None, self.ai_ready)
        if dialog.exec() != QDialog.Accepted:
            return
        try:
            with busy():
                saved = self.api.create_form(form_type, dialog.data)
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()
        if confirm(self, f"已儲存，表單編號 {saved.get('number', '')}。\n是否立即列印？", "儲存完成"):
            self.print_page(form_id=saved.get("id", ""))

    def edit(self) -> None:
        record = self.table.current_row_data()
        if not record:
            QMessageBox.information(self, "修改", "請先選取一筆表單。")
            return
        dialog = FormEditor(self, self.api, record["type"], record, self.ai_ready)
        if dialog.exec() != QDialog.Accepted:
            return
        try:
            with busy():
                self.api.update_form(record["id"], dialog.data)
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()

    def remove(self) -> None:
        record = self.table.current_row_data()
        if not record:
            QMessageBox.information(self, "刪除", "請先選取一筆表單。")
            return
        if not confirm(self, f"確定刪除 {record.get('number', '')}「{record.get('title', '')}」？\n表單編號不會重複使用。"):
            return
        try:
            with busy():
                self.api.delete_form(record["id"])
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()

    def print_selected(self) -> None:
        record = self.table.current_row_data()
        if not record:
            QMessageBox.information(self, "列印", "請先選取一筆表單。")
            return
        self.print_page(form_id=record["id"])

    def print_page(self, form_id: str = "", blank_type: str = "") -> None:
        try:
            with busy():
                html = self.api.form_print_html(form_id=form_id, blank_type=blank_type)
        except ApiError as error:
            show_error(self, error)
            return
        folder = os.path.join(tempfile.gettempdir(), "ClubDesk")
        os.makedirs(folder, exist_ok=True)
        name = re.sub(r"[^\w-]", "_", blank_type or form_id) or "form"
        path = os.path.join(folder, f"{name}.html")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(html)
        if not QDesktopServices.openUrl(QUrl.fromLocalFile(path)):
            QMessageBox.information(self, "列印", f"無法自動開啟瀏覽器，請手動開啟：\n{path}")

    def edit_settings(self) -> None:
        dialog = SettingsDialog(self, self.settings)
        if dialog.exec() != QDialog.Accepted:
            return
        try:
            with busy():
                self.api.save_form_settings(dialog.values())
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()

