"""Notifier: one place that turns an event into a tray pop-up, a sound and a taskbar flash.

The main window decides *what* is new; this module decides *how* the user is told.
The sound is played even when there is no tray icon (or the pop-up is hidden by
Windows Focus Assist), so a background user still hears new messages.
"""

from __future__ import annotations

from PySide6.QtWidgets import QApplication, QSystemTrayIcon

from .sound import play_notification_sound


class Notifier:
    def __init__(self, window, tray: QSystemTrayIcon | None, icon, sound_enabled):
        self.window = window
        self.tray = tray
        self.icon = icon
        self.sound_enabled = sound_enabled  # callable: whether the 提示音 setting is on
        self.target = None                  # what a click on the pop-up opens
        self.conv = ""

    def notify(self, title: str, text: str, target=None, conv: str = "", msecs: int = 6000, quiet: bool = False) -> None:
        """Show the pop-up; unless `quiet` (start-up summary) also chime and flash the taskbar."""
        self.target, self.conv = target, conv
        if self.tray:
            self.tray.showMessage(title, text, self.icon, msecs)
        if quiet:
            return
        if self.sound_enabled():
            play_notification_sound()
        QApplication.alert(self.window, 0)
