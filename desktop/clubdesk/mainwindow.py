"""Main window: menu bar, toolbar, navigation tree on the left, work area, status bar.

Also checks for unread messages and announcements every 30 seconds (on a
worker thread) and shows them on the navigation tree, the status bar and as a
system tray notification.
"""

from __future__ import annotations

from PySide6.QtCore import QSettings, Qt, QTimer
from PySide6.QtGui import QAction, QKeySequence
from PySide6.QtWidgets import (QDialog, QLabel, QMainWindow, QMessageBox, QSplitter, QStackedWidget,
                               QSystemTrayIcon, QTreeWidget, QTreeWidgetItem)

from . import __version__
from .api import (ROLE_LABELS, ApiClient, can_manage_equipment, can_manage_finance, can_manage_members,
                  can_manage_users, can_view_cms)
from .help import HelpWindow, WelcomeDialog
from .icons import app_icon, icon
from .pages.admin import AssistantPage, NotesPage, ReportsPage, UsersPage
from .pages.equipment import EquipmentPage
from .pages.finance import FinancePage
from .pages.forms import FormsPage
from .pages.meetings import MeetingsPage
from .pages.members import FeeReceiptsPage, MembersPage
from .pages.messages import AnnouncementsPage, MessagesPage, PushSettingsDialog
from .pages.other import AccountPage, RegulationsPage
from .pages.website import HomepagePage, PagesPage, PostsPage
from .updater import PublishDialog, check_and_offer
from .widgets import background, open_url

APP_TITLE = "北科無人機社 社務管理系統"
POLL_MS = 30000


def navigation(role: str) -> list:
    """(group, group icon, [(page class, allowed)]) in menu order."""
    cms = can_view_cms(role)
    return [
        ("社團通訊", "messages", [(AnnouncementsPage, True), (MessagesPage, True)]),
        ("網站管理", "site", [(PostsPage, cms), (PagesPage, cms), (HomepagePage, cms)]),
        ("社務管理", "members", [(MembersPage, can_manage_members(role)), (FeeReceiptsPage, can_manage_members(role)),
                             (MeetingsPage, True), (NotesPage, cms)]),
        ("文書作業", "forms", [(FormsPage, True)]),
        ("財務管理", "finance", [(FinancePage, can_manage_finance(role))]),
        ("器材管理", "equipment", [(EquipmentPage, can_manage_equipment(role))]),
        ("AI 工具", "ai", [(AssistantPage, True), (ReportsPage, cms)]),
        ("系統管理", "users", [(UsersPage, can_manage_users(role)), (RegulationsPage, True), (AccountPage, True)]),
    ]


class MainWindow(QMainWindow):
    def __init__(self, api: ApiClient, user: dict, login_factory=None):
        super().__init__()
        self.api = api
        self.user = user
        self.login_factory = login_factory
        self.pages = []
        self.items: dict[type, QTreeWidgetItem] = {}
        self.unread: dict = {}
        self.notified: set = set()
        self.first_check = True
        self.setWindowTitle(f"{APP_TITLE} - [{user.get('username')}]")
        self.setWindowIcon(app_icon())
        self.resize(1180, 740)

        # ------------------------------------------------ navigation + pages
        self.tree = QTreeWidget()
        self.tree.setHeaderLabel("功能選單")
        self.tree.setRootIsDecorated(True)
        self.tree.setMinimumWidth(180)
        self.stack = QStackedWidget()
        for group, group_icon, entries in navigation(user.get("role", "")):
            allowed = [cls for cls, ok in entries if ok]
            if not allowed:
                continue
            parent = QTreeWidgetItem(self.tree, [group])
            parent.setIcon(0, icon(group_icon))
            parent.setFlags(parent.flags() & ~Qt.ItemIsSelectable)
            for cls in allowed:
                page = cls(api, user, self.set_message)
                self.stack.addWidget(page)
                self.pages.append(page)
                child = QTreeWidgetItem(parent, [cls.title])
                child.setIcon(0, icon(cls.icon_name))
                child.setData(0, Qt.UserRole, len(self.pages) - 1)
                self.items[cls] = child
        self.tree.expandAll()
        self.tree.currentItemChanged.connect(self.tree_changed)

        splitter = QSplitter(Qt.Horizontal)
        splitter.addWidget(self.tree)
        splitter.addWidget(self.stack)
        splitter.setStretchFactor(1, 1)
        splitter.setSizes([200, 980])
        self.setCentralWidget(splitter)

        self.build_actions()
        self.build_status_bar()
        self.build_tray()
        self.restore_geometry()
        first = self.tree.topLevelItem(0).child(0) if self.tree.topLevelItemCount() else None
        if first:
            self.tree.setCurrentItem(first)

        self.poll = QTimer(self)
        self.poll.setInterval(POLL_MS)
        self.poll.timeout.connect(self.check_messages)
        self.poll.start()
        QTimer.singleShot(500, self.check_messages)
        QTimer.singleShot(300, lambda: WelcomeDialog.maybe_show(self))

    # ------------------------------------------------------------- chrome
    def build_actions(self) -> None:
        def action(text, slot, shortcut=None, icon_name=None, tip=None):
            act = QAction(text, self)
            act.triggered.connect(slot)
            if shortcut:
                act.setShortcut(QKeySequence(shortcut))
            if icon_name:
                act.setIcon(icon(icon_name))
            act.setStatusTip(tip or text.replace("&", "").rstrip("."))
            return act

        president = can_manage_users(self.user.get("role", ""))
        self.act_refresh = action("重新整理(&R)", self.refresh_current, "F5", "refresh", "重新從伺服器讀取資料")
        self.act_export = action("匯出 CSV(&E)...", self.export_current, "Ctrl+E", "export", "將目前表格匯出成 Excel 可開啟的 CSV 檔")
        self.act_messages = action("訊息中心(&M)", lambda: self.show_class(MessagesPage), "Ctrl+M", "messages", "社團聊天室與私人訊息")
        self.act_site = action("開啟社團網站(&W)", lambda: open_url(self, self.api.base_url + "/"), None, "site", "用瀏覽器開啟社團網站首頁")
        self.act_admin = action("開啟網站後台(&B)", lambda: open_url(self, self.api.base_url + "/admin"), None, "open-web", "用瀏覽器開啟網站後台")
        self.act_logout = action("登出並切換使用者(&L)...", self.relogin, None, "logout")
        self.act_exit = action("結束(&X)", self.close, "Alt+F4", "exit")
        self.act_tutorial = action("使用教學(&H)", lambda: HelpWindow.open(self), "F1", "tutorial", "開啟本系統的使用教學")
        self.act_quick = action("快速入門(&Q)", lambda: HelpWindow.open(self, "快速入門"), None, "lightbulb")
        self.act_welcome = action("新功能介紹(&N)...", lambda: WelcomeDialog(self).exec(), None, "ai")
        self.act_about = action("關於本系統(&A)...", self.about, None, "about")
        self.act_password = action("變更密碼(&P)...", self.change_password, None, "password")
        self.act_update = action("檢查更新(&U)...", lambda: check_and_offer(self, self.api, quiet=False), None, "update",
                                 "向網站查詢是否有新版本")
        self.act_publish = action("發布桌面版更新(&R)...", lambda: PublishDialog(self, self.api).exec(), None, "publish",
                                  "通知所有社員安裝新版本（社長）")
        self.act_push = action("外部推播設定(&O)...", lambda: PushSettingsDialog(self, self.api).exec(), None, "announce",
                               "Discord／Slack／LINE 等外部推播（社長，選用）")

        menu = self.menuBar()
        file_menu = menu.addMenu("檔案(&F)")
        file_menu.addActions([self.act_refresh, self.act_export])
        file_menu.addSeparator()
        file_menu.addActions([self.act_site, self.act_admin])
        file_menu.addSeparator()
        file_menu.addActions([self.act_logout, self.act_exit])
        view_menu = menu.addMenu("檢視(&V)")
        for index, page in enumerate(self.pages):
            act = QAction(icon(page.icon_name), page.title, self)
            if index < 9:
                act.setShortcut(QKeySequence(f"Ctrl+{index + 1}"))
            act.triggered.connect(lambda _=False, i=index: self.show_page(i))
            view_menu.addAction(act)
        tools_menu = menu.addMenu("工具(&T)")
        tools_menu.addActions([self.act_messages, self.act_password])
        if president:
            tools_menu.addSeparator()
            tools_menu.addActions([self.act_push, self.act_publish])
        help_menu = menu.addMenu("說明(&H)")
        help_menu.addActions([self.act_tutorial, self.act_quick, self.act_welcome])
        help_menu.addSeparator()
        help_menu.addAction(self.act_update)
        help_menu.addSeparator()
        help_menu.addAction(self.act_about)

        toolbar = self.addToolBar("標準按鈕")
        toolbar.setMovable(False)
        toolbar.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)
        toolbar.addActions([self.act_refresh, self.act_export])
        toolbar.addSeparator()
        toolbar.addActions([self.act_messages, self.act_site])
        toolbar.addSeparator()
        toolbar.addActions([self.act_tutorial, self.act_logout])

    def build_status_bar(self) -> None:
        bar = self.statusBar()
        self.message = QLabel("就緒")
        bar.addWidget(self.message, 1)
        self.unread_label = QLabel(" 訊息：— ")
        self.unread_label.setToolTip("未讀訊息與公告，每 30 秒更新")
        bar.addPermanentWidget(self.unread_label)
        bar.addPermanentWidget(QLabel(f" 使用者：{self.user.get('username')}（{ROLE_LABELS.get(self.user.get('role'), self.user.get('role'))}） "))
        bar.addPermanentWidget(QLabel(f" 伺服器：{self.api.base_url} "))

    def build_tray(self) -> None:
        self.tray = None
        if not QSystemTrayIcon.isSystemTrayAvailable():
            return
        self.tray = QSystemTrayIcon(app_icon(), self)
        self.tray.setToolTip(APP_TITLE)
        self.tray.messageClicked.connect(self.open_notification)
        self.tray.activated.connect(lambda reason: (self.showNormal(), self.activateWindow()) if reason == QSystemTrayIcon.Trigger else None)
        self.tray.show()
        self.pending_target = MessagesPage

    def set_message(self, text: str) -> None:
        self.message.setText(text)

    # -------------------------------------------------------- notifications
    def check_messages(self) -> None:
        background(self.api.message_summary, self.show_unread, lambda _error: None)

    def show_unread(self, summary: dict) -> None:
        messages, announcements = summary.get("unreadMessages", 0), summary.get("unreadAnnouncements", 0)
        self.unread_label.setText(f" 未讀訊息 {messages}・公告 {announcements} ")
        for cls, count in ((MessagesPage, messages), (AnnouncementsPage, announcements)):
            item = self.items.get(cls)
            if item:
                item.setText(0, f"{cls.title} ({count})" if count else cls.title)
                font = item.font(0)
                font.setBold(bool(count))
                item.setFont(0, font)
        # New items since the last check become a tray notification (not on start-up for old ones).
        fresh_announcements = [a for a in summary.get("announcements", []) if f"a:{a['id']}" not in self.notified]
        fresh_messages = [c for c in summary.get("conversations", []) if f"c:{c['conv']}:{c.get('lastAt')}" not in self.notified]
        self.notified.update(f"a:{a['id']}" for a in fresh_announcements)
        self.notified.update(f"c:{c['conv']}:{c.get('lastAt')}" for c in fresh_messages)
        first = self.first_check
        self.first_check = False
        current = self.stack.currentWidget()
        if isinstance(current, MessagesPage):
            fresh_messages = [c for c in fresh_messages if c["conv"] != current.conv]
        if not self.tray:
            return
        if fresh_announcements:
            self.pending_target = AnnouncementsPage
            title = "新公告" if not first else f"您有 {announcements} 則未讀公告"
            self.tray.showMessage(title, fresh_announcements[0]["title"], app_icon(), 8000)
        elif fresh_messages and not first:
            self.pending_target = MessagesPage
            conv = fresh_messages[0]
            self.tray.showMessage(f"新訊息：{conv.get('name', '')}", f"{conv.get('lastAuthor', '')}：{conv.get('lastPreview', '')}", app_icon(), 6000)
        elif first and messages:
            self.pending_target = MessagesPage
            self.tray.showMessage("未讀訊息", f"您有 {messages} 則未讀訊息", app_icon(), 6000)

    def open_notification(self) -> None:
        self.showNormal()
        self.activateWindow()
        self.show_class(self.pending_target)

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

    def show_class(self, cls) -> None:
        for index, page in enumerate(self.pages):
            if isinstance(page, cls):
                self.show_page(index)
                return

    def current_page(self):
        return self.stack.currentWidget()

    def refresh_current(self) -> None:
        page = self.current_page()
        if page:
            page.safe_refresh()
        self.check_messages()

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
                          f"社團網站：<a href='{self.api.base_url}'>{self.api.base_url}</a><br>"
                          "資料與社團網站後台共用，所有變更會即時寫入網站伺服器。<br><br>"
                          "圖示取自 Lucide（ISC 授權）。")

    def relogin(self) -> None:
        """Sign out and show the login dialog again; quit if it is cancelled."""
        self.poll.stop()
        self.api.logout()
        if self.tray:
            self.tray.hide()
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
        self.poll.stop()
        self.save_geometry()
        if self.tray:
            self.tray.hide()
        self.api.logout()  # end the server session when the program closes
        super().closeEvent(event)
