"""通知中心: notification history, per-computer settings and the settings dialog.

The main window checks the unread summary every 30 seconds (also while it is
hidden in the system tray), turns new announcements and messages into tray
pop-ups and records them here. The 通知中心 page lists the unread items and the
recent history, and jumps to the conversation or announcement on double-click.
"""

from __future__ import annotations

import json
from datetime import datetime

from PySide6.QtCore import QObject, QSettings, Signal
from PySide6.QtWidgets import QCheckBox, QDialog, QGroupBox, QLabel, QVBoxLayout

from .widgets import DataTable, Page, button_row, confirm, icon_button, show_error

HISTORY_LIMIT = 100
DEFAULTS = {
    "enabled": True,          # tray pop-ups at all
    "announcements": True,
    "messages": True,
    "sound": True,            # system beep with the pop-up
    "close_to_tray": True,    # the window's X hides to the tray and keeps running
    "minimize_to_tray": False,  # the minimise button also hides to the tray
}
LABELS = {"announcement": "公告", "message": "訊息", "system": "系統"}


def setting(name: str) -> bool:
    value = QSettings().value(f"notify/{name}", DEFAULTS[name])
    return value in (True, "true", "1", 1)


def set_setting(name: str, value: bool) -> None:
    QSettings().setValue(f"notify/{name}", bool(value))


class NotificationCenter(QObject):
    """Recent notifications for one account, kept in QSettings between runs."""

    changed = Signal()

    def __init__(self, username: str = ""):
        super().__init__()
        self.key = f"notify/history/{username or '_'}"
        self.unread_items: list[dict] = []  # from the latest summary
        try:
            self.history: list[dict] = json.loads(QSettings().value(self.key, "[]") or "[]")
        except (TypeError, ValueError):
            self.history = []

    def add(self, kind: str, title: str, body: str, target: str = "messages", conv: str = "") -> None:
        self.history.insert(0, {"at": datetime.now().isoformat(timespec="seconds"), "kind": kind, "title": title,
                                "body": body, "target": target, "conv": conv})
        del self.history[HISTORY_LIMIT:]
        self.save()

    def set_unread(self, summary: dict) -> None:
        items = [{"kind": "announcement", "title": ("📌 " if a.get("pinned") else "") + a.get("title", ""),
                  "body": a.get("createdByName", ""), "at": a.get("createdAt", ""), "target": "announcements", "conv": ""}
                 for a in summary.get("announcements", [])]
        items += [{"kind": "message", "title": f"{c.get('name', '')}（{c.get('unread', 0)} 則未讀）",
                   "body": f"{c.get('lastAuthor', '')}：{c.get('lastPreview', '')}", "at": c.get("lastAt", ""),
                   "target": "messages", "conv": c.get("conv", "")}
                  for c in summary.get("conversations", [])]
        if items != self.unread_items:  # avoid rebuilding the table (and losing the selection) every poll
            self.unread_items = items
            self.changed.emit()

    def clear(self) -> None:
        self.history = []
        self.save()

    def save(self) -> None:
        QSettings().setValue(self.key, json.dumps(self.history, ensure_ascii=False))
        self.changed.emit()


def short_time(iso: str) -> str:
    if not iso:
        return ""
    try:
        moment = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if moment.tzinfo:
            moment = moment.astimezone().replace(tzinfo=None)
    except ValueError:
        return iso[:16]
    return moment.strftime("%H:%M") if moment.date() == datetime.now().date() else moment.strftime("%m/%d %H:%M")


class NotificationSettingsDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("通知設定")
        layout = QVBoxLayout(self)
        self.boxes: dict[str, QCheckBox] = {}

        def box(name, text, group):
            check = QCheckBox(text)
            check.setChecked(setting(name))
            self.boxes[name] = check
            group.addWidget(check)

        popups = QGroupBox("右下角通知")
        popups_layout = QVBoxLayout(popups)
        box("enabled", "顯示通知（取消勾選即為勿擾模式）", popups_layout)
        box("announcements", "新公告", popups_layout)
        box("messages", "新訊息（聊天室、私人訊息）", popups_layout)
        box("sound", "通知時發出提示音", popups_layout)
        layout.addWidget(popups)
        tray = QGroupBox("背景執行")
        tray_layout = QVBoxLayout(tray)
        box("close_to_tray", "按視窗的 ✕ 時縮小到右下角系統匣，在背景繼續接收通知", tray_layout)
        box("minimize_to_tray", "按「最小化」時也縮小到系統匣（不佔工作列）", tray_layout)
        tip = QLabel("要完全結束程式，請用「檔案 → 結束」或在系統匣圖示按右鍵選「結束」。")
        tip.setWordWrap(True)
        tray_layout.addWidget(tip)
        layout.addWidget(tray)
        ok, cancel = icon_button("確定", "check"), icon_button("取消", "cross")
        ok.clicked.connect(self.accept)
        cancel.clicked.connect(self.reject)
        layout.addLayout(button_row(ok, cancel, stretch_first=True))

    def accept(self) -> None:
        for name, check in self.boxes.items():
            set_setting(name, check.isChecked())
        super().accept()


class NotificationsPage(Page):
    title = "通知中心"
    icon_name = "bell"
    export_name = "通知紀錄.csv"

    def __init__(self, api, user: dict, status):
        super().__init__(api, user, status)
        self.center: NotificationCenter | None = None
        self.navigate = None  # set by the main window: navigate(target, conv)
        self.summary_label = QLabel("")
        self.body.addWidget(self.summary_label)
        self.table = DataTable([("時間", "time"), ("狀態", "state"), ("類型", "kind"), ("標題", "title"), ("內容", "body")])
        self.table.doubleClicked.connect(lambda _index: self.open_selected())
        self.body.addWidget(self.table, 1)
        open_button = icon_button("前往查看", "messages", "開啟選取的公告或對話（也可以直接雙擊）")
        open_button.clicked.connect(self.open_selected)
        read_all = icon_button("全部標為已讀", "check")
        read_all.clicked.connect(self.read_all)
        clear = icon_button("清除紀錄", "delete")
        clear.clicked.connect(self.clear)
        settings = icon_button("通知設定", "bell")
        settings.clicked.connect(lambda: NotificationSettingsDialog(self).exec())
        self.body.addLayout(button_row(open_button, read_all, clear, settings))

    def attach(self, center: NotificationCenter, navigate) -> None:
        self.center = center
        self.navigate = navigate
        center.changed.connect(self.render)
        self.render()

    def refresh(self) -> None:
        self.render()

    def render(self) -> None:
        if not self.center:
            return
        unread = [{**item, "state": "未讀"} for item in self.center.unread_items]
        history = [{**item, "state": "紀錄"} for item in self.center.history]
        rows = [{**item, "time": short_time(item.get("at", "")), "kind": LABELS.get(item.get("kind"), item.get("kind", ""))}
                for item in unread + history]
        self.table.set_rows(rows)
        self.summary_label.setText(f"未讀 {len(unread)} 項・通知紀錄 {len(history)} 筆（雙擊即可前往查看）"
                                   + ("" if setting("enabled") else "　🔕 勿擾模式中"))

    def open_selected(self) -> None:
        row = self.table.current_row_data()
        if row and self.navigate:
            self.navigate(row.get("target", "messages"), row.get("conv", ""))

    def read_all(self) -> None:
        try:
            self.api.post("/api/messages/read-all", {})
        except Exception as error:  # noqa: BLE001 - report every failure to the user
            show_error(self, error)
            return
        self.status("已全部標為已讀")
        if self.navigate:
            self.navigate(None, "")  # just re-check the unread summary

    def clear(self) -> None:
        if self.center and confirm(self, "清除所有通知紀錄？（未讀項目不受影響）"):
            self.center.clear()
