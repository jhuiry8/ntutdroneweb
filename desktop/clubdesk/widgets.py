"""Shared widgets: data grid, page frame, error box and wait cursor."""

from __future__ import annotations

import csv
import os
import re
import tempfile
from contextlib import contextmanager
from typing import Callable

from PySide6.QtCore import QObject, QRunnable, Qt, QThreadPool, QUrl, Signal
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (QAbstractItemView, QApplication, QFileDialog, QFrame, QHBoxLayout,
                               QHeaderView, QLabel, QMessageBox, QPushButton, QTableWidget,
                               QTableWidgetItem, QVBoxLayout, QWidget)

from .api import ApiError
from .docx import Document
from .icons import icon

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


class _Signals(QObject):
    done = Signal(object)
    failed = Signal(object)


class _Job(QRunnable):
    def __init__(self, work):
        super().__init__()
        self.work = work
        self.signals = _Signals()

    def run(self) -> None:
        try:
            result = self.work()
        except Exception as error:  # noqa: BLE001 - handed to the caller on the UI thread
            self.signals.failed.emit(error)
        else:
            self.signals.done.emit(result)


_running: set = set()


def background(work: Callable, done: Callable | None = None, failed: Callable | None = None) -> None:
    """Runs work() on a worker thread (network calls) and calls done/failed back on the UI thread."""
    job = _Job(work)
    _running.add(job)  # keep the signal object alive until the job reports back

    def finish(callback, value):
        _running.discard(job)
        if callback:
            callback(value)

    job.signals.done.connect(lambda value: finish(done, value))
    job.signals.failed.connect(lambda error: finish(failed, error))
    job.setAutoDelete(False)
    QThreadPool.globalInstance().start(job)


def open_url(parent, url: str) -> None:
    if not QDesktopServices.openUrl(QUrl(url)):
        QMessageBox.information(parent, "開啟網頁", f"無法自動開啟瀏覽器，請手動開啟：\n{url}")


def open_html(parent, html: str, name: str) -> None:
    """Saves a page to the temp folder and opens it in the browser (printing, previews)."""
    folder = os.path.join(tempfile.gettempdir(), "ClubDesk")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, (re.sub(r"[^\w-]", "_", name) or "page") + ".html")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(html)
    if not QDesktopServices.openUrl(QUrl.fromLocalFile(path)):
        QMessageBox.information(parent, "開啟網頁", f"無法自動開啟瀏覽器，請手動開啟：\n{path}")


def icon_button(text: str, icon_name: str = "", tip: str = "") -> QPushButton:
    button = QPushButton(text)
    if icon_name:
        button.setIcon(icon(icon_name))
    if tip:
        button.setToolTip(tip)
    return button


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

    def visible_rows(self) -> list[list[str]]:
        """The cells as shown (current sort order and filter)."""
        return [[self.item(r, c).text() if self.item(r, c) else "" for c in range(self.columnCount())] for r in range(self.rowCount())]

    def export_docx(self, parent, path: str, title: str, subtitle: str = "") -> None:
        right = {i for i, column in enumerate(self.columns) if len(column) > 2 and column[2] == "right"}
        headers = [c[0] for c in self.columns]
        document = Document(title, landscape=len(headers) > 6)
        document.title_block(title, subtitle)
        document.table(headers, self.visible_rows(), align_right=right)
        document.paragraph(f"共 {self.rowCount()} 筆", align="right", size=18)
        save_docx(parent, document, path)


def docx_path(parent, default_name: str) -> str:
    """Asks where to save a Word file; '' when cancelled."""
    name = default_name if default_name.lower().endswith(".docx") else re.sub(r"\.\w+$", "", default_name) + ".docx"
    path, _ = QFileDialog.getSaveFileName(parent, "匯出 Word", name, "Word 文件 (*.docx)")
    if path and not path.lower().endswith(".docx"):
        path += ".docx"
    return path


def export_info(user: dict | None, server: str = "") -> str:
    from datetime import datetime
    who = f"・匯出者 {user.get('username')}" if user else ""
    return f"匯出時間 {datetime.now():%Y-%m-%d %H:%M}{who}" + (f"・{server}" if server else "")


def save_docx(parent, document: Document, path: str) -> bool:
    try:
        document.save(path)
    except OSError as error:
        QMessageBox.warning(parent, "匯出 Word", f"無法儲存檔案（檔案是否正在 Word 中開啟？）：\n{error}")
        return False
    if QMessageBox.question(parent, "匯出完成", f"已儲存至\n{path}\n\n要現在開啟嗎？",
                            QMessageBox.Yes | QMessageBox.No, QMessageBox.Yes) == QMessageBox.Yes:
        QDesktopServices.openUrl(QUrl.fromLocalFile(path))
    return True


class Page(QWidget):
    """A work area with a caption bar, like the right pane of a classic MMC console."""

    title = ""
    icon_name = ""
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
        caption = QWidget()
        caption.setObjectName("CaptionBar")
        caption.setAttribute(Qt.WA_StyledBackground, True)
        caption_row = QHBoxLayout(caption)
        caption_row.setContentsMargins(6, 3, 6, 3)
        caption_row.setSpacing(6)
        if self.icon_name:
            badge = QLabel()
            badge.setPixmap(icon(self.icon_name, light=True).pixmap(16, 16))
            caption_row.addWidget(badge)
        caption_text = QLabel(self.title)
        caption_text.setObjectName("CaptionText")
        caption_row.addWidget(caption_text, 1)
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

    def export_docx(self) -> None:
        """Word export of the current page; pages with richer content override it."""
        if self.table is None:
            QMessageBox.information(self, "匯出 Word", "此畫面沒有可匯出的表格。")
            return
        path = docx_path(self, self.export_name if self.export_name != "export.csv" else f"{self.title}.docx")
        if not path:
            return
        self.table.export_docx(self, path, self.title, export_info(self.user, getattr(self.api, "base_url", "")))


# Buttons without an icon get one from the start of their caption.
AUTO_ICONS = [("新增", "add"), ("修改", "edit"), ("批次", "edit"), ("刪除", "delete"), ("查詢", "search"), ("列印", "print"),
              ("匯入", "import"), ("匯出", "export"), ("核准", "check"), ("退回", "cross"), ("變更密碼", "password"),
              ("AI", "ai"), ("全選", "check"), ("儲存", "save"), ("清除", "delete"), ("登錄", "add"), ("編輯", "edit"),
              ("設定", "edit"), ("關閉", "cross"), ("確定", "check")]


def button_row(*buttons: QPushButton, stretch_first=False) -> QHBoxLayout:
    row = QHBoxLayout()
    row.setSpacing(4)
    if stretch_first:
        row.addStretch(1)
    for button in buttons:
        button.setMinimumWidth(80)
        if button.icon().isNull():
            caption = button.text().replace("&", "")
            name = next((icon_name for prefix, icon_name in AUTO_ICONS if caption.startswith(prefix)), "")
            if name:
                button.setIcon(icon(name))
        row.addWidget(button)
    if not stretch_first:
        row.addStretch(1)
    return row
