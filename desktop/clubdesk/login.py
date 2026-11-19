"""Login dialog: server address, account, password and the site's image CAPTCHA."""

from __future__ import annotations

from PySide6.QtCore import QByteArray, QSettings, Qt, QTimer
from PySide6.QtGui import QPainter, QPixmap
from PySide6.QtSvg import QSvgRenderer
from PySide6.QtWidgets import (QCheckBox, QDialog, QDialogButtonBox, QFrame, QGridLayout, QGroupBox,
                               QHBoxLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout)

from . import autostart, saved_session
from .api import DEFAULT_SERVER, ApiClient, ApiError, normalize_base_url
from .icons import app_icon, app_pixmap, icon
from .updater import check_and_offer
from .widgets import busy, show_error


def svg_pixmap(svg: str) -> QPixmap:
    renderer = QSvgRenderer(QByteArray(svg.encode("utf-8")))
    size = renderer.defaultSize()
    pixmap = QPixmap(size if size.isValid() else renderer.viewBox().size())
    pixmap.fill(Qt.white)
    painter = QPainter(pixmap)
    renderer.render(painter)
    painter.end()
    return pixmap


class LoginDialog(QDialog):
    def __init__(self, parent=None, notice: str = ""):
        super().__init__(parent)
        self.setWindowTitle("登入 - 北科無人機社 社務管理系統")
        self.setWindowFlag(Qt.WindowContextHelpButtonHint, False)
        self.setWindowIcon(app_icon())
        self.settings = QSettings()
        self.client: ApiClient | None = None
        self.user: dict | None = None
        self.captcha_id = ""
        self.update_checked = False

        banner = QLabel("北科無人機社　社務管理系統\nNTUT Drone Club Management System")
        banner.setObjectName("Banner")
        logo = QLabel()
        logo.setPixmap(app_pixmap(48))
        logo.setObjectName("BannerLogo")
        banner_row = QHBoxLayout()
        banner_row.setSpacing(0)
        banner_row.addWidget(logo)
        banner_row.addWidget(banner, 1)

        self.server = QLineEdit(self.settings.value("server", "", str) or DEFAULT_SERVER)
        self.server.setPlaceholderText(DEFAULT_SERVER)
        default = QPushButton("預設")
        default.setToolTip(f"改回社團網站 {DEFAULT_SERVER}")
        default.clicked.connect(lambda: (self.server.setText(DEFAULT_SERVER), self.server_changed()))
        self.username = QLineEdit(self.settings.value("username", "", str))
        self.password = QLineEdit()
        self.password.setEchoMode(QLineEdit.Password)
        self.captcha_image = QLabel("（尚未取得驗證碼）")
        self.captcha_image.setFixedSize(184, 64)
        self.captcha_image.setAlignment(Qt.AlignCenter)
        self.captcha_image.setFrameShape(QFrame.Panel)
        self.captcha_image.setFrameShadow(QFrame.Sunken)
        self.captcha_answer = QLineEdit()
        self.captcha_answer.setMaxLength(5)
        refresh = QPushButton(icon("refresh"), "換一張(&R)")
        refresh.clicked.connect(self.load_captcha)

        box = QGroupBox("登入資訊")
        grid = QGridLayout(box)
        grid.addWidget(QLabel("伺服器網址(&S)："), 0, 0)
        grid.addWidget(self.server, 0, 1)
        grid.addWidget(default, 0, 2)
        grid.addWidget(QLabel("帳號(&U)："), 1, 0)
        grid.addWidget(self.username, 1, 1, 1, 2)
        grid.addWidget(QLabel("密碼(&P)："), 2, 0)
        grid.addWidget(self.password, 2, 1, 1, 2)
        grid.addWidget(QLabel("驗證碼："), 3, 0, Qt.AlignTop)
        grid.addWidget(self.captcha_image, 3, 1)
        grid.addWidget(refresh, 3, 2, Qt.AlignTop)
        grid.addWidget(QLabel("請輸入驗證碼(&C)："), 4, 0)
        grid.addWidget(self.captcha_answer, 4, 1, 1, 2)
        for i, widget in enumerate((self.server, self.username, self.password, self.captcha_answer)):
            label = grid.itemAtPosition((0, 1, 2, 4)[i], 0).widget()
            label.setBuddy(widget)

        self.remember = QCheckBox("保持登入 30 天（下次開啟程式自動登入）(&K)")
        self.remember.setChecked(self.settings.value("login/remember", True, bool))
        self.autostart = QCheckBox("開機時自動啟動並縮小到系統匣(&A)")
        # On by default; afterwards the last choice is remembered.
        self.autostart.setChecked(self.settings.value("login/autostart", True, bool))
        self.autostart.setVisible(autostart.supported())
        grid.addWidget(self.remember, 5, 0, 1, 3)
        grid.addWidget(self.autostart, 6, 0, 1, 3)

        buttons = QDialogButtonBox()
        self.ok = buttons.addButton("登入", QDialogButtonBox.AcceptRole)
        buttons.addButton("取消", QDialogButtonBox.RejectRole)
        buttons.accepted.connect(self.try_login)
        buttons.rejected.connect(self.reject)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 8)
        layout.addLayout(banner_row)
        inner = QVBoxLayout()
        inner.setContentsMargins(10, 4, 10, 0)
        inner.addWidget(box)
        hint = QLabel((notice + "\n" if notice else "") + "驗證碼不分大小寫，五分鐘內有效，每張只能使用一次。")
        hint.setStyleSheet("color: #404040;")
        inner.addWidget(hint)
        row = QHBoxLayout()
        row.addStretch(1)
        row.addWidget(buttons)
        inner.addLayout(row)
        layout.addLayout(inner)
        self.setFixedWidth(460)

        self.server.editingFinished.connect(self.server_changed)
        self._captcha_server = ""
        if self.server.text().strip():
            self.load_captcha()
        if not self.server.text():
            self.server.setFocus()
        elif not self.username.text():
            self.username.setFocus()
        else:
            self.password.setFocus()

    def server_changed(self) -> None:
        if normalize_base_url(self.server.text()) != self._captcha_server:
            self.load_captcha()

    def load_captcha(self) -> None:
        url = normalize_base_url(self.server.text())
        if not url:
            return
        self.client = ApiClient(url)
        self._captcha_server = url
        self.captcha_answer.clear()
        try:
            with busy():
                captcha = self.client.captcha()
        except ApiError as error:
            self.captcha_id = ""
            self.captcha_image.setText("無法取得驗證碼")
            show_error(self, error)
            return
        self.captcha_id = captcha["id"]
        self.captcha_image.setPixmap(svg_pixmap(captcha["svg"]))
        if not self.update_checked:
            # Once the server answers, ask it whether a newer desktop version exists.
            self.update_checked = True
            QTimer.singleShot(0, self.check_update)

    def check_update(self) -> None:
        if self.client and check_and_offer(self, self.client):
            self.reject()

    def try_login(self) -> None:
        url = normalize_base_url(self.server.text())
        if not url:
            show_error(self, ApiError("請輸入伺服器網址。"))
            self.server.setFocus()
            return
        if url != self._captcha_server or not self.captcha_id:
            self.load_captcha()
            if not self.captcha_id:
                return
        if not self.username.text().strip() or not self.password.text():
            show_error(self, ApiError("請輸入帳號與密碼。"))
            return
        if len(self.captcha_answer.text().strip()) != 5:
            show_error(self, ApiError("請輸入 5 碼驗證碼。"))
            self.captcha_answer.setFocus()
            return
        try:
            with busy():
                self.user = self.client.login(self.username.text().strip().lower(), self.password.text(),
                                              self.captcha_id, self.captcha_answer.text().strip(),
                                              self.remember.isChecked())
        except ApiError as error:
            show_error(self, error, "登入失敗")
            if "密碼" in str(error):
                self.password.clear()
            self.load_captcha()  # each CAPTCHA can be used only once
            self.captcha_answer.setFocus()
            return
        self.settings.setValue("server", url)
        self.settings.setValue("username", self.username.text().strip().lower())
        self.settings.setValue("login/remember", self.remember.isChecked())
        if self.remember.isChecked() and self.client.token:
            saved_session.save(url, self.user.get("username", ""), self.client.token, self.client.session_seconds or None)
        else:
            saved_session.clear()
        self.settings.setValue("login/autostart", self.autostart.isChecked())
        if autostart.supported():
            try:
                autostart.set_enabled(self.autostart.isChecked() and self.remember.isChecked())
            except OSError as error:
                show_error(self, ApiError(f"無法設定開機自動啟動：{error}"))
        self.accept()
