"""Start the 北科無人機社 社務管理系統 desktop program."""

import sys
import time

from PySide6.QtCore import QLibraryInfo, QLocale, QTimer, QTranslator
from PySide6.QtWidgets import QApplication, QDialog

from clubdesk import __version__, saved_session
from clubdesk.api import ApiClient, ApiError
from clubdesk.icons import app_icon
from clubdesk.login import LoginDialog
from clubdesk.mainwindow import MainWindow
from clubdesk.style import apply_classic_style
from clubdesk.updater import check_and_offer


def auto_login(autostarted: bool):
    """Sign in with the saved 30-day session. Returns (client, user, notice).

    Right after Windows starts the network may not be ready yet, so an automatic
    start retries for about a minute. An expired or rejected session is dropped
    and the person is asked to sign in again with a note why.
    """
    saved = saved_session.load()
    if not saved:
        return None, None, ""
    client = ApiClient(saved["server"])
    client.token = saved["token"]
    for attempt in range(20 if autostarted else 1):
        try:
            return client, client.me(), ""
        except ApiError as error:
            if error.status in (401, 403):
                saved_session.clear()
                return None, None, "30 天登入期限已到或登入已失效，請重新登入。"
            if "無法連線" not in str(error) and error.status < 500:
                break
        if attempt < 19 and autostarted:
            time.sleep(3)
    return None, None, "目前無法連線到伺服器，無法自動登入。"


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

    autostarted = "--autostart" in sys.argv
    client, user, notice = auto_login(autostarted)
    skipped_login_dialog = bool(client)
    if not client:
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
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
