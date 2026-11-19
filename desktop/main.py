"""Start the 北科無人機社 社務管理系統 desktop program."""

import sys

from clubdesk import qtcompat  # noqa: F401  (PySide2 fallback for Windows 7; must come first)
from PySide6.QtCore import QLibraryInfo, QLocale, QTranslator
from PySide6.QtWidgets import QApplication

from clubdesk import __version__, i18n
from clubdesk.icons import app_icon
from clubdesk.login import LoginDialog, run_login
from clubdesk.mainwindow import MainWindow
from clubdesk.style import apply_classic_style


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
    # Interface language: Traditional Chinese (default) or English (Help -> Language).
    i18n.set_language(i18n.saved_language())
    i18n.install()
    apply_classic_style(app)
    if not i18n.is_english():
        # Chinese text on Qt's own buttons (Yes/No, OK/Cancel in message boxes).
        QLocale.setDefault(QLocale(QLocale.Chinese, QLocale.Taiwan))
        translator = QTranslator(app)
        if translator.load("qtbase_zh_TW", QLibraryInfo.path(QLibraryInfo.TranslationsPath)):
            app.installTranslator(translator)

    login = run_login(LoginDialog)
    if login is None:
        return 0
    window = MainWindow(login.client, login.user, LoginDialog)
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
