"""Main window: menu bar, toolbar, navigation tree on the left, work area, status bar."""

from __future__ import annotations

from PySide6.QtCore import QSettings, Qt
from PySide6.QtGui import QAction, QKeySequence
from PySide6.QtWidgets import (QDialog, QLabel, QMainWindow, QMessageBox, QSplitter, QStackedWidget,
                               QStyle, QTreeWidget, QTreeWidgetItem)

from . import __version__
from .api import (ROLE_LABELS, ApiClient, can_manage_equipment, can_manage_finance,
                  can_manage_members, can_manage_users)
from .pages.equipment import EquipmentPage
from .pages.finance import FinancePage
from .pages.forms import FormsPage
from .pages.members import FeeReceiptsPage, MembersPage
from .pages.other import AccountPage, RegulationsPage
from .updater import PublishDialog, check_and_offer

APP_TITLE = "北科無人機社 社務管理系統"


class MainWindow(QMainWindow):
    def __init__(self, api: ApiClient, user: dict, login_factory=None):
        super().__init__()
        self.api = api
        self.user = user
        self.login_factory = login_factory
        self.pages = []
        self.setWindowTitle(f"{APP_TITLE} - [{user.get('username')}]")
        self.resize(1100, 700)

        # ------------------------------------------------ navigation + pages
        self.tree = QTreeWidget()
        self.tree.setHeaderLabel("功能選單")
        self.tree.setRootIsDecorated(True)
        self.tree.setMinimumWidth(170)
        self.stack = QStackedWidget()
        role = user.get("role", "")
        style = self.style()
        folder = style.standardIcon(QStyle.SP_DirIcon)
        leaf = style.standardIcon(QStyle.SP_FileIcon)
        groups = [
            ("社務管理", [(MembersPage, can_manage_members(role)), (FeeReceiptsPage, can_manage_members(role))]),
            ("文書作業", [(FormsPage, True)]),
            ("財務管理", [(FinancePage, can_manage_finance(role))]),
            ("器材管理", [(EquipmentPage, can_manage_equipment(role))]),
            ("其他", [(RegulationsPage, True), (AccountPage, True)]),
        ]
        for group, entries in groups:
            allowed = [cls for cls, ok in entries if ok]
            if not allowed:
                continue
            parent = QTreeWidgetItem(self.tree, [group])
            parent.setIcon(0, folder)
            parent.setFlags(parent.flags() & ~Qt.ItemIsSelectable)
            for cls in allowed:
                page = cls(api, user, self.set_message)
                self.stack.addWidget(page)
                self.pages.append(page)
                child = QTreeWidgetItem(parent, [cls.title])
                child.setIcon(0, leaf)
                child.setData(0, Qt.UserRole, len(self.pages) - 1)
        self.tree.expandAll()
        self.tree.currentItemChanged.connect(self.tree_changed)

        splitter = QSplitter(Qt.Horizontal)
        splitter.addWidget(self.tree)
        splitter.addWidget(self.stack)
        splitter.setStretchFactor(1, 1)
        splitter.setSizes([190, 900])
        self.setCentralWidget(splitter)

        self.build_actions()
        self.build_status_bar()
        self.restore_geometry()
        first = self.tree.topLevelItem(0).child(0) if self.tree.topLevelItemCount() else None
        if first:
            self.tree.setCurrentItem(first)

    # ------------------------------------------------------------- chrome
    def build_actions(self) -> None:
        style = self.style()

        def action(text, slot, shortcut=None, icon=None, tip=None):
            act = QAction(text, self)
            act.triggered.connect(slot)
            if shortcut:
                act.setShortcut(QKeySequence(shortcut))
            if icon is not None:
                act.setIcon(style.standardIcon(icon))
            act.setStatusTip(tip or text.replace("&", "").rstrip("."))
            return act

        self.act_refresh = action("重新整理(&R)", self.refresh_current, "F5", QStyle.SP_BrowserReload, "重新從伺服器讀取資料")
        self.act_export = action("匯出 CSV(&E)...", self.export_current, "Ctrl+E", QStyle.SP_DialogSaveButton, "將目前表格匯出成 Excel 可開啟的 CSV 檔")
        self.act_logout = action("登出並切換使用者(&L)...", self.relogin, None, QStyle.SP_DialogResetButton)
        self.act_exit = action("結束(&X)", self.close, "Alt+F4")
        self.act_about = action("關於本系統(&A)...", self.about, None, QStyle.SP_MessageBoxInformation)
        self.act_password = action("變更密碼(&P)...", self.change_password, None, None)
        self.act_update = action("檢查更新(&U)...", lambda: check_and_offer(self, self.api, quiet=False), None, None,
                                 "向網站查詢是否有新版本")
        self.act_publish = action("發布桌面版更新(&R)...", lambda: PublishDialog(self, self.api).exec(), None, None,
                                  "通知所有社員安裝新版本（社長）")

        menu = self.menuBar()
        file_menu = menu.addMenu("檔案(&F)")
        file_menu.addActions([self.act_refresh, self.act_export])
        file_menu.addSeparator()
        file_menu.addActions([self.act_logout, self.act_exit])
        view_menu = menu.addMenu("檢視(&V)")
        for index, page in enumerate(self.pages):
            act = QAction(page.title, self)
            if index < 9:
                act.setShortcut(QKeySequence(f"Ctrl+{index + 1}"))
            act.triggered.connect(lambda _=False, i=index: self.show_page(i))
            view_menu.addAction(act)
        tools_menu = menu.addMenu("工具(&T)")
        tools_menu.addAction(self.act_password)
        if can_manage_users(self.user.get("role", "")):
            tools_menu.addSeparator()
            tools_menu.addAction(self.act_publish)
        help_menu = menu.addMenu("說明(&H)")
        help_menu.addAction(self.act_update)
        help_menu.addSeparator()
        help_menu.addAction(self.act_about)

        toolbar = self.addToolBar("標準按鈕")
        toolbar.setMovable(False)
        toolbar.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)
        toolbar.addActions([self.act_refresh, self.act_export])
        toolbar.addSeparator()
        toolbar.addActions([self.act_logout, self.act_about])

    def build_status_bar(self) -> None:
        bar = self.statusBar()
        self.message = QLabel("就緒")
        bar.addWidget(self.message, 1)
        bar.addPermanentWidget(QLabel(f" 使用者：{self.user.get('username')}（{ROLE_LABELS.get(self.user.get('role'), self.user.get('role'))}） "))
        bar.addPermanentWidget(QLabel(f" 伺服器：{self.api.base_url} "))

    def set_message(self, text: str) -> None:
        self.message.setText(text)

    # ------------------------------------------------------------ actions
    def tree_changed(self, item, _previous=None) -> None:
        index = item.data(0, Qt.UserRole) if item else None
        if index is None:
            return
        self.stack.setCurrentIndex(index)
        page = self.pages[index]
        self.set_message(page.title)
        page.ensure_loaded()

    def show_page(self, index: int) -> None:
        for i in range(self.tree.topLevelItemCount()):
            group = self.tree.topLevelItem(i)
            for j in range(group.childCount()):
                if group.child(j).data(0, Qt.UserRole) == index:
                    self.tree.setCurrentItem(group.child(j))
                    return

    def current_page(self):
        return self.stack.currentWidget()

    def refresh_current(self) -> None:
        page = self.current_page()
        if page:
            page.safe_refresh()

    def export_current(self) -> None:
        page = self.current_page()
        if page:
            page.export_csv()

    def change_password(self) -> None:
        for index, page in enumerate(self.pages):
            if isinstance(page, AccountPage):
                self.show_page(index)
                page.change_password()
                return

    def about(self) -> None:
        QMessageBox.about(self, "關於本系統",
                          f"<b>{APP_TITLE}</b><br>版本 {__version__}<br><br>"
                          "國立臺北科技大學無人機社 社務管理桌面程式。<br>"
                          "資料與社團網站後台共用，所有變更會即時寫入網站伺服器。")

    def relogin(self) -> None:
        """Sign out and show the login dialog again; quit if it is cancelled."""
        self.api.logout()
        if not self.login_factory:
            self.close()
            return
        self.hide()
        dialog = self.login_factory()
        if dialog.exec() == QDialog.Accepted:
            window = MainWindow(dialog.client, dialog.user, self.login_factory)
            window.show()
            # Keep a reference so the new window is not garbage-collected.
            self.successor = window
        self.save_geometry()
        self.close()

    # ----------------------------------------------------------- settings
    def restore_geometry(self) -> None:
        geometry = QSettings().value("window/geometry")
        if geometry is not None:
            self.restoreGeometry(geometry)

    def save_geometry(self) -> None:
        QSettings().setValue("window/geometry", self.saveGeometry())

    def closeEvent(self, event) -> None:  # noqa: N802 - Qt naming
        self.save_geometry()
        self.api.logout()  # end the server session when the program closes
        super().closeEvent(event)
