"""收支帳目 page: ledger, review and budget categories."""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QComboBox, QDialog, QFormLayout, QGridLayout, QGroupBox, QInputDialog,
                               QLabel, QLineEdit, QMessageBox, QPushButton, QSpinBox, QTableWidget,
                               QTableWidgetItem, QTabWidget, QVBoxLayout, QWidget)

from ..api import ApiError, can_manage_users
from ..widgets import DataTable, Page, busy, button_row, confirm, money, show_error
from .members import combo, date_edit, date_text, dialog_buttons

KINDS = [("income", "收入"), ("expense", "支出"), ("transfer", "轉帳（現金↔郵局）")]
KIND_LABELS = {"income": "收入", "expense": "支出", "transfer": "轉帳"}
ACCOUNTS = [("cash", "現金"), ("postal", "郵局")]
STATUS_LABELS = {"pending": "待審核", "approved": "已核准", "rejected": "已退回"}


class TransactionDialog(QDialog):
    def __init__(self, parent, budgets: list[dict]):
        super().__init__(parent)
        self.setWindowTitle("新增收支")
        self.day = date_edit()
        self.item = QLineEdit()
        self.item.setMaxLength(120)
        self.kind = combo(KINDS, "expense")
        self.amount = QSpinBox()
        self.amount.setRange(1, 1_000_000_000)
        self.amount.setGroupSeparatorShown(True)
        self.amount.setSuffix(" 元")
        self.account = combo(ACCOUNTS)
        self.account_label = QLabel("帳戶：")
        self.budget = QComboBox()
        self.budget.addItem("（不指定）", "")
        for budget in budgets:
            self.budget.addItem(budget.get("name", ""), budget.get("id", ""))
        self.kind.currentIndexChanged.connect(self.kind_changed)
        form = QFormLayout()
        form.addRow("日期：", self.day)
        form.addRow("事由：", self.item)
        form.addRow("類型：", self.kind)
        form.addRow("金額：", self.amount)
        form.addRow(self.account_label, self.account)
        form.addRow("預算分類：", self.budget)
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(QLabel("新增的帳目需經社長審核後才會計入餘額。"))
        layout.addWidget(dialog_buttons(self))
        self.setMinimumWidth(360)
        self.kind_changed()

    def kind_changed(self) -> None:
        transfer = self.kind.currentData() == "transfer"
        self.account_label.setText("轉出帳戶：" if transfer else "帳戶：")
        self.budget.setEnabled(self.kind.currentData() == "expense")

    def accept(self) -> None:
        if not self.item.text().strip():
            QMessageBox.warning(self, "資料不完整", "請填寫事由。")
            return
        super().accept()

    def values(self) -> dict:
        return {"date": date_text(self.day), "item": self.item.text().strip(), "kind": self.kind.currentData(),
                "amount": self.amount.value(), "account": self.account.currentData(),
                "budgetId": self.budget.currentData() if self.kind.currentData() == "expense" else ""}


class BudgetDialog(QDialog):
    def __init__(self, parent, budgets: list[dict]):
        super().__init__(parent)
        self.setWindowTitle("編輯預算分類")
        self.grid = QTableWidget(0, 2)
        self.grid.setHorizontalHeaderLabels(["分類名稱", "預算金額"])
        self.grid.horizontalHeader().setStretchLastSection(True)
        self.grid.verticalHeader().setVisible(False)
        for budget in budgets:
            self.add_row(budget.get("name", ""), budget.get("planned", 0), budget.get("id", ""))
        add = QPushButton("新增一列")
        add.clicked.connect(lambda: self.add_row())
        remove = QPushButton("刪除此列")
        remove.clicked.connect(lambda: self.grid.removeRow(self.grid.currentRow()))
        layout = QVBoxLayout(self)
        layout.addWidget(self.grid)
        layout.addLayout(button_row(add, remove))
        layout.addWidget(dialog_buttons(self))
        self.resize(380, 320)

    def add_row(self, name="", planned=0, budget_id="") -> None:
        r = self.grid.rowCount()
        self.grid.insertRow(r)
        item = QTableWidgetItem(name)
        item.setData(Qt.UserRole, budget_id)
        self.grid.setItem(r, 0, item)
        self.grid.setItem(r, 1, QTableWidgetItem(str(planned)))

    def values(self) -> list[dict]:
        budgets = []
        for r in range(self.grid.rowCount()):
            name_item, planned_item = self.grid.item(r, 0), self.grid.item(r, 1)
            name = name_item.text().strip() if name_item else ""
            if not name:
                continue
            planned = (planned_item.text() if planned_item else "0").replace(",", "").strip() or "0"
            budget = {"name": name, "planned": int(planned) if planned.isdigit() else planned}
            if name_item.data(Qt.UserRole):
                budget["id"] = name_item.data(Qt.UserRole)
            budgets.append(budget)
        return budgets


class FinancePage(Page):
    title = "收支帳目"
    export_name = "收支帳目.csv"

    def __init__(self, *args):
        super().__init__(*args)
        self.budgets: list[dict] = []
        summary = QGroupBox("帳戶摘要（已核准帳目）")
        grid = QGridLayout(summary)
        self.totals = {}
        for i, (key, label) in enumerate([("cashBalance", "現金餘額"), ("postalBalance", "郵局餘額"),
                                           ("income", "累計收入"), ("expense", "累計支出"),
                                           ("pendingCount", "待審核筆數"), ("pendingNet", "待審核淨額")]):
            value = QLabel("-")
            value.setObjectName("Total")
            value.setMinimumWidth(110)
            grid.addWidget(QLabel(label + "："), i // 3, (i % 3) * 2)
            grid.addWidget(value, i // 3, (i % 3) * 2 + 1)
            self.totals[key] = value
        self.body.addWidget(summary)

        tabs = QTabWidget()
        ledger = QWidget()
        ledger_layout = QVBoxLayout(ledger)
        self.table = DataTable([
            ("日期", "date"), ("事由", "item"), ("類型", lambda t: KIND_LABELS.get(t.get("kind"), "")),
            ("收入", lambda t: money(t.get("income")) if t.get("income") else "", "right"),
            ("支出", lambda t: money(t.get("expense")) if t.get("expense") else "", "right"),
            ("現金變動", lambda t: money(t.get("cashDelta")) if t.get("cashDelta") else "", "right"),
            ("郵局變動", lambda t: money(t.get("postalDelta")) if t.get("postalDelta") else "", "right"),
            ("預算分類", lambda t: self.budget_name(t.get("budgetId"))),
            ("狀態", lambda t: STATUS_LABELS.get(t.get("status"), t.get("status", ""))),
            ("登錄者", "createdBy"), ("審核者", "reviewedBy"), ("退回原因", "reviewNote"),
        ])
        ledger_layout.addWidget(self.table, 1)
        add = QPushButton("新增收支(&N)...")
        add.clicked.connect(self.add)
        approve = QPushButton("核准(&A)")
        approve.clicked.connect(lambda: self.review("approved"))
        reject = QPushButton("退回(&J)...")
        reject.clicked.connect(lambda: self.review("rejected"))
        remove = QPushButton("刪除(&D)")
        remove.clicked.connect(self.remove)
        president = can_manage_users(self.role)
        approve.setEnabled(president)
        reject.setEnabled(president)
        if not president:
            approve.setToolTip("僅社長可審核收支")
            reject.setToolTip("僅社長可審核收支")
        ledger_layout.addLayout(button_row(add, approve, reject, remove))
        tabs.addTab(ledger, "收支明細")

        budget_tab = QWidget()
        budget_layout = QVBoxLayout(budget_tab)
        self.budget_table = DataTable([
            ("分類", "name"), ("預算", lambda b: money(b.get("planned")), "right"),
            ("已支出", lambda b: money(b.get("spent")), "right"),
            ("剩餘", lambda b: money((b.get("planned") or 0) - (b.get("spent") or 0)), "right"),
            ("執行率", lambda b: f"{(b.get('spent') or 0) * 100 // b['planned']}%" if b.get("planned") else "-", "right"),
        ])
        budget_layout.addWidget(self.budget_table, 1)
        edit_budget = QPushButton("編輯預算分類(&B)...")
        edit_budget.clicked.connect(self.edit_budgets)
        budget_layout.addLayout(button_row(edit_budget))
        tabs.addTab(budget_tab, "預算執行")
        self.body.addWidget(tabs, 1)

    def budget_name(self, budget_id: str) -> str:
        return next((b.get("name", "") for b in self.budgets if b.get("id") == budget_id), "")

    def refresh(self) -> None:
        summary = self.api.finance_summary()
        self.budgets = summary.get("budgets", [])
        self.table.set_rows(summary.get("transactions", []))
        self.budget_table.set_rows(self.budgets)
        totals = summary.get("totals", {})
        for key, label in self.totals.items():
            if key == "pendingCount":
                label.setText(f"{totals.get(key, 0)} 筆")
            elif key == "pendingNet":
                label.setText(f"NT$ {money(totals.get('pendingIncome', 0) - totals.get('pendingExpense', 0))}")
            else:
                label.setText(f"NT$ {money(totals.get(key, 0))}")
        self.status(f"帳目 {len(summary.get('transactions', []))} 筆，待審核 {totals.get('pendingCount', 0)} 筆")

    def call(self, action) -> None:
        try:
            with busy():
                action()
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()

    def add(self) -> None:
        dialog = TransactionDialog(self, self.budgets)
        if dialog.exec() == QDialog.Accepted:
            self.call(lambda: self.api.create_transaction(dialog.values()))

    def review(self, status: str) -> None:
        item = self.table.current_row_data()
        if not item:
            QMessageBox.information(self, "審核", "請先選取一筆帳目。")
            return
        if item.get("status") != "pending":
            QMessageBox.information(self, "審核", "此帳目已完成審核。")
            return
        note = ""
        if status == "rejected":
            note, ok = QInputDialog.getText(self, "退回帳目", f"退回「{item.get('item')}」的原因：")
            if not ok:
                return
            if not note.strip():
                QMessageBox.warning(self, "退回帳目", "請填寫退回原因。")
                return
        elif not confirm(self, f"確定核准「{item.get('item')}」NT$ {money(item.get('amount'))}？"):
            return
        self.call(lambda: self.api.review_transaction(item["id"], status, note.strip()))

    def remove(self) -> None:
        item = self.table.current_row_data()
        if not item:
            QMessageBox.information(self, "刪除", "請先選取一筆帳目。")
            return
        if item.get("status") != "rejected":
            QMessageBox.information(self, "刪除", "只有「已退回」的帳目可以刪除。")
            return
        if confirm(self, f"確定刪除已退回的帳目「{item.get('item')}」？"):
            self.call(lambda: self.api.delete_transaction(item["id"]))

    def edit_budgets(self) -> None:
        dialog = BudgetDialog(self, self.budgets)
        if dialog.exec() == QDialog.Accepted:
            self.call(lambda: self.api.save_budgets(dialog.values()))
