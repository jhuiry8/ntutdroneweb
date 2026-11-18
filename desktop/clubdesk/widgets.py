"""Shared widgets: data grid, page frame, error box and wait cursor."""

from __future__ import annotations

import csv
from contextlib import contextmanager
from typing import Callable

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QAbstractItemView, QApplication, QFileDialog, QFrame, QHBoxLayout,
                               QHeaderView, QLabel, QMessageBox, QPushButton, QTableWidget,
                               QTableWidgetItem, QVBoxLayout, QWidget)

from .api import ApiError

Column = tuple  # (header, key or callable, optional "right" alignment)


@contextmanager
def busy():
    QApplication.setOverrideCursor(Qt.WaitCursor)
    try:
        yield
    finally:
        QApplication.restoreOverrideCursor()


def show_error(parent, error: Exception, title: str = "錯誤") -> None:
    message = str(error) if isinstance(error, ApiError) else f"發生未預期的錯誤：{error}"
    QMessageBox.critical(parent, title, message)
    if isinstance(error, ApiError) and error.status == 401 and parent is not None:
        relogin = getattr(parent.window(), "relogin", None)
        if relogin:
            relogin()


def confirm(parent, message: str, title: str = "確認") -> bool:
    return QMessageBox.question(parent, title, message, QMessageBox.Yes | QMessageBox.No,
                                QMessageBox.No) == QMessageBox.Yes


def money(value) -> str:
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return ""


class DataTable(QTableWidget):
    """Read-only grid with gridlines, alternating rows and whole-row selection."""

    def __init__(self, columns: list[Column], parent=None, multi=False):
        super().__init__(0, len(columns), parent)
        self.columns = columns
        self.rows: list[dict] = []
        self.setHorizontalHeaderLabels([c[0] for c in columns])
        self.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.setSelectionMode(QAbstractItemView.ExtendedSelection if multi else QAbstractItemView.SingleSelection)
        self.setAlternatingRowColors(True)
        self.setShowGrid(True)
        self.setSortingEnabled(True)
        self.verticalHeader().setDefaultSectionSize(20)
        self.verticalHeader().setVisible(False)
        self.horizontalHeader().setHighlightSections(False)
        # Keep the server's order until the user clicks a column header.
        self.horizontalHeader().setSortIndicator(-1, Qt.AscendingOrder)
        self.horizontalHeader().setStretchLastSection(True)
        self.horizontalHeader().setSectionResizeMode(QHeaderView.Interactive)
        self.setFrameShape(QFrame.Panel)
        self.setFrameShadow(QFrame.Sunken)

    @staticmethod
    def cell_text(column: Column, row: dict) -> str:
        key = column[1]
        value = key(row) if callable(key) else row.get(key, "")
        return "" if value is None else str(value)

    def set_rows(self, rows: list[dict]) -> None:
        self.setSortingEnabled(False)
        self.clearContents()
        self.rows = list(rows)
        self.setRowCount(len(self.rows))
        for r, row in enumerate(self.rows):
            for c, column in enumerate(self.columns):
                item = QTableWidgetItem(self.cell_text(column, row))
                item.setData(Qt.UserRole, r)
                if len(column) > 2 and column[2] == "right":
                    item.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                self.setItem(r, c, item)
        self.setSortingEnabled(True)
        self.resizeColumnsToContents()
        for c in range(self.columnCount()):
            if self.columnWidth(c) > 260:
                self.setColumnWidth(c, 260)

    def selected_rows(self) -> list[dict]:
        indexes = sorted({index.row() for index in self.selectedIndexes()})
        return [self.rows[self.item(i, 0).data(Qt.UserRole)] for i in indexes if self.item(i, 0)]

    def current_row_data(self) -> dict | None:
        rows = self.selected_rows()
        return rows[0] if rows else None

    def export_csv(self, parent, default_name: str) -> None:
        path, _ = QFileDialog.getSaveFileName(parent, "匯出 CSV", default_name, "CSV 檔案 (*.csv)")
        if not path:
            return
        # utf-8-sig so Excel opens Chinese text correctly.
        with open(path, "w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.writer(handle)
            writer.writerow([c[0] for c in self.columns])
            for r in range(self.rowCount()):
                writer.writerow([self.item(r, c).text() if self.item(r, c) else "" for c in range(self.columnCount())])
        QMessageBox.information(parent, "匯出完成", f"已匯出 {self.rowCount()} 筆資料至\n{path}")


class Page(QWidget):
    """A work area with a caption bar, like the right pane of a classic MMC console."""

    title = ""
    export_name = "export.csv"

    def __init__(self, api, user: dict, status: Callable[[str], None]):
        super().__init__()
        self.api = api
        self.user = user
        self.status = status
        self.table: DataTable | None = None
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(4)
        caption = QLabel(self.title)
        caption.setObjectName("CaptionBar")
        outer.addWidget(caption)
        self.body = QVBoxLayout()
        self.body.setContentsMargins(6, 2, 6, 6)
        self.body.setSpacing(6)
        outer.addLayout(self.body)
        self.loaded = False

    @property
    def role(self) -> str:
        return self.user.get("role", "")

    def refresh(self) -> None:
        raise NotImplementedError

    def ensure_loaded(self) -> None:
        if not self.loaded:
            self.loaded = True
            self.safe_refresh()

    def safe_refresh(self) -> None:
        try:
            with busy():
                self.refresh()
        except Exception as error:  # noqa: BLE001 - report every failure to the user
            show_error(self, error)

    def export_csv(self) -> None:
        if self.table is None:
            QMessageBox.information(self, "匯出", "此畫面沒有可匯出的表格。")
            return
        self.table.export_csv(self, self.export_name)


def button_row(*buttons: QPushButton, stretch_first=False) -> QHBoxLayout:
    row = QHBoxLayout()
    row.setSpacing(4)
    if stretch_first:
        row.addStretch(1)
    for button in buttons:
        button.setMinimumWidth(80)
        row.addWidget(button)
    if not stretch_first:
        row.addStretch(1)
    return row
