"""Start the 北科無人機社 社務管理系統 desktop program."""

import sys

from clubdesk import qtcompat  # noqa: F401  (PySide2 fallback for Windows 7; must come first)
from PySide6.QtCore import QLibraryInfo, QLocale, QTimer, QTranslator
from PySide6.QtGui import QAction
from PySide6.QtWidgets import QApplication, QDialog, QMenu, QSystemTrayIcon

from clubdesk import __version__
from clubdesk.autologin import auto_login
from clubdesk.icons import app_icon
from clubdesk.login import LoginDialog
from clubdesk.mainwindow import MainWindow
from clubdesk.single_instance import InstanceServer, ask_running_instance
from clubdesk.style import apply_classic_style
from clubdesk.updater import check_and_offer


def wait_in_tray(app, instances, notice: str):
    """Tray icon with 登入 / 結束 until the person signs in. Returns (client, user) or (None, None)."""
    result = {}
    tray = QSystemTrayIcon(app_icon(), app)
    tray.setToolTip("北科無人機社 社務管理系統 - 尚未登入")
    menu = QMenu()
    sign_in = QAction("登入(&L)...", menu)
    quit_action = QAction("結束(&X)", menu)
    menu.addActions([sign_in, quit_action])
    tray.setContextMenu(menu)

    asking = []

    def ask_login() -> None:
        if asking:  # a second start or a tray click while the dialog is already open
            return
        asking.append(True)
        sign_in.setEnabled(False)
        dialog = LoginDialog(notice=notice)
        if dialog.exec() == QDialog.Accepted:
            result["login"] = (dialog.client, dialog.user)
            app.quit()
        sign_in.setEnabled(True)
        asking.clear()

    sign_in.triggered.connect(ask_login)
    quit_action.triggered.connect(app.quit)
    tray.activated.connect(lambda reason: ask_login() if reason in (
        QSystemTrayIcon.Trigger, QSystemTrayIcon.DoubleClick) else None)
    instances.set_handler(ask_login)
    tray.show()
    tray.showMessage("請登入", notice or "請點此圖示登入。", app_icon(), 8000)
    app.exec()
    tray.hide()
    return result.get("login", (None, None))


def main() -> int:
    if sys.platform == "win32":
        # Own taskbar group, so Windows shows the program icon instead of Python's.
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("NTUTDroneClub.ClubDesk")
    app = QApplication(sys.argv)
    app.setWindowIcon(app_icon())
    # Closing the main window can leave the program running in the system tray;
    # MainWindow quits the application itself when it really closes.
    app.setQuitOnLastWindowClosed(False)
    app.setOrganizationName("NTUT Drone Club")
    app.setApplicationName("ClubDesk")
    app.setApplicationVersion(__version__)
    apply_classic_style(app)
    # Chinese text on Qt's own buttons (Yes/No, OK/Cancel in message boxes).
    QLocale.setDefault(QLocale(QLocale.Chinese, QLocale.Taiwan))
    translator = QTranslator(app)
    if translator.load("qtbase_zh_TW", QLibraryInfo.path(QLibraryInfo.TranslationsPath)):
        app.installTranslator(translator)

    if ask_running_instance():
        return 0  # already running (maybe hidden in the tray); it was asked to show itself
    instances = InstanceServer(parent=app)
    app.instances = instances  # MainWindow.relogin points it at the new window
    autostarted = "--autostart" in sys.argv
    client, user, notice = auto_login(autostarted)
    skipped_login_dialog = bool(client)
    if not client and autostarted and QSystemTrayIcon.isSystemTrayAvailable():
        # Started with Windows but cannot sign in: wait in the tray instead of popping up a dialog.
        client, user = wait_in_tray(app, instances, notice)
        if not client:
            return 0
        skipped_login_dialog = False
    elif not client:
        login = LoginDialog(notice=notice)
        if login.exec() != QDialog.Accepted:
            return 0
        client, user, autostarted = login.client, login.user, False
    window = MainWindow(client, user, LoginDialog)
    if autostarted and window.tray:
        window.hide_to_tray_silently()  # started with Windows: stay in the tray
    else:
        window.show()
        if skipped_login_dialog:  # the login dialog normally checks for updates
            QTimer.singleShot(3000, lambda: check_and_offer(window, client))
    # Last: a second start that arrived while we were signing in is answered now, after the window is set up.
    instances.set_handler(window.restore_window)
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
