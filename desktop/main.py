"""Start the 北科無人機社 社務管理系統 desktop program."""

import sys

from PySide6.QtWidgets import QApplication, QDialog

from clubdesk import __version__
from clubdesk.login import LoginDialog
from clubdesk.mainwindow import MainWindow
from clubdesk.style import apply_classic_style


def main() -> int:
    app = QApplication(sys.argv)
    app.setOrganizationName("NTUT Drone Club")
    app.setApplicationName("ClubDesk")
    app.setApplicationVersion(__version__)
    apply_classic_style(app)

    login = LoginDialog()
    if login.exec() != QDialog.Accepted:
        return 0
    window = MainWindow(login.client, login.user, LoginDialog)
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
