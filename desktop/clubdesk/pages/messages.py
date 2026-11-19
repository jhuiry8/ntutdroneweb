"""社團通訊: 聊天室, 私人訊息, 公告 and the optional 外部推播 settings.

Shares /api/messages and /api/announcements with the website, so a message
sent here appears on the website and the other way round. The open
conversation refreshes every few seconds on a worker thread; the main window
separately checks for unread items and shows a tray notification.
"""

from __future__ import annotations

import html
import re
from datetime import datetime

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QFormLayout, QGridLayout, QGroupBox, QHBoxLayout,
                               QInputDialog, QLabel, QLineEdit, QListWidget, QListWidgetItem, QMessageBox,
                               QPlainTextEdit, QSplitter, QTextBrowser, QTreeWidget, QTreeWidgetItem, QVBoxLayout,
                               QWidget)

from ..api import ApiError, can_manage_users, can_view_cms
from ..icons import icon
from ..docx import Document
from ..i18n import raw
from ..widgets import (DataTable, Page, background, busy, button_row, confirm, docx_path, export_info, icon_button,
                       save_docx, show_error)
from .members import dialog_buttons


def when(iso: str) -> str:
    if not iso:
        return ""
    try:
        moment = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone()
    except ValueError:
        return iso[:16]
    return moment.strftime("%H:%M") if moment.date() == datetime.now().date() else moment.strftime("%m/%d %H:%M")


def local_day(iso: str) -> str:
    """The date in this computer's time zone (the server stores UTC)."""
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d")
    except ValueError:
        return iso[:10]


def message_html(text: str) -> str:
    value = html.escape(text or "")
    value = re.sub(r"(https?://[^\s<]+)", r'<a href="\1">\1</a>', value)
    return value.replace("\n", "<br>")


class ChannelDialog(QDialog):
    def __init__(self, parent, people: list[dict], channel: dict | None = None):
        super().__init__(parent)
        channel = channel or {}
        self.setWindowTitle("聊天室設定" if channel else "建立聊天室")
        self.name = QLineEdit(channel.get("name", ""))
        self.name.setMaxLength(40)
        self.description = QLineEdit(channel.get("description", ""))
        self.audience = QComboBox()
        for value, label in (("all", "全體社員"), ("officers", "幹部限定"), ("custom", "指定成員")):
            self.audience.addItem(label, value)
        self.audience.setCurrentIndex(max(self.audience.findData(channel.get("audience", "all")), 0))
        self.members = QListWidget()
        for person in people:
            item = QListWidgetItem(f"{person.get('name') or person['username']}（{person['username']}・{person.get('roleLabel', '')}）")
            item.setData(Qt.UserRole, person["username"])
            item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
            item.setCheckState(Qt.Checked if person["username"] in channel.get("members", []) else Qt.Unchecked)
            self.members.addItem(item)
        self.read_only = QCheckBox("只有幹部可以發言（公告用頻道）")
        self.read_only.setChecked(bool(channel.get("readOnly")))
        self.archived = QCheckBox("封存（停止使用，保留紀錄）")
        self.archived.setChecked(bool(channel.get("archived")))
        self.archived.setVisible(bool(channel))
        form = QFormLayout(self)
        form.addRow("名稱：", self.name)
        form.addRow("說明：", self.description)
        form.addRow("誰可以看到：", self.audience)
        self.members_label = QLabel("指定成員：")
        form.addRow(self.members_label, self.members)
        form.addRow("", self.read_only)
        form.addRow("", self.archived)
        form.addRow(dialog_buttons(self))
        self.audience.currentIndexChanged.connect(self.sync)
        self.sync()
        self.resize(420, 480)

    def sync(self) -> None:
        custom = self.audience.currentData() == "custom"
        self.members.setVisible(custom)
        self.members_label.setVisible(custom)

    def accept(self) -> None:
        if not self.name.text().strip():
            QMessageBox.warning(self, "聊天室", "請輸入聊天室名稱。")
            return
        super().accept()

    def values(self) -> dict:
        members = [self.members.item(i).data(Qt.UserRole) for i in range(self.members.count()) if self.members.item(i).checkState() == Qt.Checked]
        return {"name": self.name.text().strip(), "description": self.description.text().strip(), "audience": self.audience.currentData(),
                "members": members, "readOnly": self.read_only.isChecked(), "archived": self.archived.isChecked()}


class ComposeBox(QPlainTextEdit):
    """Enter sends, Shift+Enter adds a new line (like chat programs)."""

    def __init__(self, send):
        super().__init__()
        self.send = send

    def keyPressEvent(self, event):  # noqa: N802 - Qt naming
        if event.key() in (Qt.Key_Return, Qt.Key_Enter) and not event.modifiers() & Qt.ShiftModifier:
            self.send()
            return
        super().keyPressEvent(event)


class MessagesPage(Page):
    title = "聊天室與私訊"
    icon_name = "messages"

    def __init__(self, *args):
        super().__init__(*args)
        self.me: dict = {}
        self.people: list[dict] = []
        self.conversations: list[dict] = []
        self.conv = ""
        self.messages: list[dict] = []
        self.last_seq = 0
        self.fetching = False

        splitter = QSplitter(Qt.Horizontal)
        left = QWidget()
        left_layout = QVBoxLayout(left)
        left_layout.setContentsMargins(0, 0, 0, 0)
        self.tree = QTreeWidget()
        self.tree.setHeaderHidden(True)
        self.tree.currentItemChanged.connect(self.pick)
        left_layout.addWidget(self.tree, 1)
        new_dm = icon_button("寫私訊給...", "messages")
        new_dm.clicked.connect(self.new_dm)
        self.new_channel = icon_button("建立聊天室...", "add")
        self.new_channel.clicked.connect(self.create_channel)
        read_all = icon_button("全部標為已讀", "check")
        read_all.clicked.connect(self.read_all)
        for button in (new_dm, self.new_channel, read_all):
            left_layout.addWidget(button)

        right = QWidget()
        right_layout = QVBoxLayout(right)
        right_layout.setContentsMargins(0, 0, 0, 0)
        head = QHBoxLayout()
        self.heading = QLabel("請選擇左側的對話")
        self.heading.setObjectName("Total")
        self.settings_button = icon_button("聊天室設定...", "edit")
        self.settings_button.clicked.connect(self.edit_channel)
        head.addWidget(self.heading, 1)
        head.addWidget(self.settings_button)
        right_layout.addLayout(head)
        self.stream = QTextBrowser()
        self.stream.setOpenExternalLinks(False)
        self.stream.setOpenLinks(False)
        self.stream.anchorClicked.connect(self.link_clicked)
        right_layout.addWidget(self.stream, 1)
        self.compose = ComposeBox(self.send)
        self.compose.setPlaceholderText("輸入訊息，Enter 送出、Shift+Enter 換行")
        self.compose.setFixedHeight(64)
        send = icon_button("送出", "messages")
        send.clicked.connect(self.send)
        row = QHBoxLayout()
        row.addWidget(self.compose, 1)
        row.addWidget(send)
        self.compose_row = QWidget()
        self.compose_row.setLayout(row)
        right_layout.addWidget(self.compose_row)
        splitter.addWidget(left)
        splitter.addWidget(right)
        splitter.setSizes([240, 700])
        self.body.addWidget(splitter, 1)

        self.timer = QTimer(self)
        self.timer.setInterval(4000)
        self.timer.timeout.connect(self.fetch_new)

    # ------------------------------------------------------------ loading
    def refresh(self) -> None:
        if not self.people:
            who = self.api.people()
            self.me, self.people = who["me"], who["people"]
        self.new_channel.setVisible(bool(self.me.get("officer")))
        self.conversations = self.api.conversations()
        self.render_tree()
        self.timer.start()

    def person(self, username: str) -> str:
        for person in self.people:
            if person["username"] == username:
                return f"{person['name']}（{username}）" if person.get("name") else username
        return username

    def render_tree(self) -> None:
        self.tree.blockSignals(True)
        self.tree.clear()
        groups = {}
        for key, label, name in (("channel", "聊天室", "messages"), ("dm", "私人訊息", "account")):
            item = QTreeWidgetItem(self.tree, [label])
            item.setIcon(0, icon("folder-open"))
            item.setFlags(item.flags() & ~Qt.ItemIsSelectable)
            groups[key] = (item, name)
        selected = None
        for conv in sorted(self.conversations, key=lambda c: c.get("lastAt") or "", reverse=True):
            parent, name = groups[conv["kind"]]
            title = self.person(conv["with"]) if conv["kind"] == "dm" else conv["name"] + ("（已封存）" if conv.get("archived") else "")
            if conv.get("unread"):
                title += f"  ({conv['unread']})"
            item = QTreeWidgetItem(parent, [title])
            item.setIcon(0, icon(name))
            item.setData(0, Qt.UserRole, conv["conv"])
            item.setToolTip(0, (conv.get("lastAuthor", "") + "：" + conv.get("lastPreview", "")) if conv.get("lastPreview") else conv.get("description", ""))
            if conv.get("unread"):
                font = item.font(0)
                font.setBold(True)
                item.setFont(0, font)
            if conv["conv"] == self.conv:
                selected = item
        self.tree.expandAll()
        if selected:
            self.tree.setCurrentItem(selected)
        self.tree.blockSignals(False)
        if not self.conv:
            first = groups["channel"][0].child(0)
            if first:
                self.tree.setCurrentItem(first)
        unread = sum(c.get("unread", 0) for c in self.conversations)
        self.status(f"聊天室與私訊：未讀 {unread} 則")

    def current(self) -> dict | None:
        return next((c for c in self.conversations if c["conv"] == self.conv), None)

    def pick(self, item, _previous=None) -> None:
        conv = item.data(0, Qt.UserRole) if item else None
        if not conv:
            return
        self.open(conv)

    def open(self, conv: str) -> None:
        self.conv = conv
        self.messages = []
        self.last_seq = 0
        info = self.current()
        if conv.startswith("dm~"):
            other = next((n for n in conv.split("~")[1:] if n != self.me.get("username")), self.me.get("username", ""))
            self.heading.setText(f" 私人訊息：{raw(self.person(other))} ")
        elif info:
            extra = "・".join(x for x in (info.get("audienceLabel"), "僅幹部可發言" if info.get("readOnly") else "", raw(info.get("description"))) if x)
            self.heading.setText(f" {raw(info['name'])}　{extra} ")
        can_manage = bool(info and info["kind"] == "channel" and (self.me.get("president") or info.get("createdBy") == self.me.get("username")))
        self.settings_button.setVisible(can_manage)
        writable = not info or (not info.get("archived") and (not info.get("readOnly") or self.me.get("officer")))
        self.compose_row.setEnabled(writable)
        self.compose.setPlaceholderText("輸入訊息，Enter 送出、Shift+Enter 換行" if writable else "此聊天室目前無法發言")
        self.stream.setHtml("<p style='color:#808080'>載入中…</p>")
        self.fetch_new()

    def fetch_new(self) -> None:
        if not self.conv or self.fetching or not self.isVisible():
            return
        self.fetching = True
        conv, after = self.conv, self.last_seq

        def stale() -> bool:
            # The user switched (or reopened) a conversation while this request ran: load that one now.
            if conv != self.conv or after != self.last_seq:
                self.fetch_new()
                return True
            return False

        def done(data):
            self.fetching = False
            if stale():
                return
            new = data.get("messages", [])
            if new:
                self.messages.extend(new)
                self.last_seq = new[-1]["seq"]
                self.render_messages()
                background(lambda: self.api.mark_read(conv, self.last_seq), lambda _r: self.mark_local_read(conv), lambda _e: None)
            elif not self.messages:
                self.render_messages()

        def failed(error):
            self.fetching = False
            if stale():
                return
            self.stream.setHtml(f"<p style='color:#A11D1D'>{raw(html.escape(str(error)))}</p>")

        background(lambda: self.api.messages(conv, after), done, failed)

    def mark_local_read(self, conv: str) -> None:
        info = next((c for c in self.conversations if c["conv"] == conv), None)
        if info and info.get("unread"):
            info["unread"] = 0
            self.render_tree()
        window = self.window()
        if hasattr(window, "check_messages"):
            window.check_messages()

    def render_messages(self) -> None:
        bar = self.stream.verticalScrollBar()
        at_bottom = bar.value() >= bar.maximum() - 30
        rows = []
        mine = self.me.get("username")
        for message in self.messages:
            own = message.get("author") == mine
            tools = ""
            if not message.get("deleted"):
                links = []
                if own:
                    links.append(f'<a href="edit:{message["seq"]}">編輯</a>')
                if own or self.me.get("president"):
                    links.append(f'<a href="delete:{message["seq"]}">刪除</a>')
                tools = f" <span style='font-size:8pt'>{' '.join(links)}</span>" if links else ""
            colour = "#1F4E9A" if own else "#000000"
            body = "<i style='color:#808080'>訊息已刪除</i>" if message.get("deleted") else raw(message_html(message.get("text", "")))
            edited = "（已編輯）" if message.get("editedAt") and not message.get("deleted") else ""
            rows.append(f"<p style='margin:2px 0 8px 0'><b style='color:{colour}'>{raw(html.escape(message.get('authorName') or message.get('author', '')))}</b>"
                        f" <span style='color:#808080; font-size:8pt'>{when(message.get('createdAt', ''))}{edited}</span>{tools}<br>{body}</p>")
        self.stream.setHtml("".join(rows) or "<p style='color:#808080'>還沒有訊息，說聲嗨吧！</p>")
        if at_bottom or len(self.messages) <= 80:
            bar.setValue(bar.maximum())

    # ------------------------------------------------------------ actions
    def send(self) -> None:
        text = self.compose.toPlainText().strip()
        if not text or not self.conv:
            return
        try:
            self.api.send_message(self.conv, text)
        except ApiError as error:
            show_error(self, error)
            return
        self.compose.clear()
        self.fetch_new()

    def link_clicked(self, url) -> None:
        target = url.toString()
        if target.startswith(("edit:", "delete:")):
            action, seq = target.split(":")
            message = next((m for m in self.messages if m["seq"] == int(seq)), None)
            if not message:
                return
            try:
                if action == "edit":
                    text, ok = QInputDialog.getMultiLineText(self, "修改訊息", "訊息：", message.get("text", ""))
                    if not ok or not text.strip():
                        return
                    message.update(self.api.edit_message(self.conv, message["seq"], text))
                elif confirm(self, "確定刪除這則訊息？"):
                    message.update(self.api.delete_message(self.conv, message["seq"]))
            except ApiError as error:
                show_error(self, error)
            self.render_messages()
        else:
            from ..widgets import open_url
            open_url(self, target)

    def new_dm(self) -> None:
        others = [p for p in self.people if p["username"] != self.me.get("username")]
        labels = [f"{p.get('name') or p['username']}（{p['username']}・{p.get('roleLabel', '')}）" for p in others]
        if not labels:
            return
        choice, ok = QInputDialog.getItem(self, "寫私訊", "要傳訊息給誰？", labels, 0, False)
        if not ok:
            return
        target = others[labels.index(choice)]["username"]
        try:
            conv = self.api.open_dm(target)["conv"]
        except ApiError as error:
            show_error(self, error)
            return
        if not any(c["conv"] == conv for c in self.conversations):
            self.conversations.append({"conv": conv, "kind": "dm", "with": target, "name": target, "unread": 0, "lastAt": datetime.utcnow().isoformat()})
        self.conv = conv
        self.render_tree()
        self.open(conv)
        self.compose.setFocus()

    def create_channel(self) -> None:
        dialog = ChannelDialog(self, self.people)
        if dialog.exec() != QDialog.Accepted:
            return
        try:
            with busy():
                channel = self.api.create_channel(dialog.values())
        except ApiError as error:
            show_error(self, error)
            return
        self.conv = channel["conv"]
        self.safe_refresh()

    def edit_channel(self) -> None:
        info = self.current()
        if not info:
            return
        dialog = ChannelDialog(self, self.people, info)
        if dialog.exec() != QDialog.Accepted:
            return
        try:
            with busy():
                self.api.update_channel(info["id"], dialog.values())
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()
        self.open(self.conv)

    def read_all(self) -> None:
        try:
            with busy():
                self.api.mark_all_read()
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()
        window = self.window()
        if hasattr(window, "check_messages"):
            window.check_messages()

    def export_csv(self) -> None:
        QMessageBox.information(self, "匯出", "聊天內容請用「匯出 Word」（Ctrl+Shift+E）匯出目前的對話。")

    def export_docx(self) -> None:
        """Transcript of the open conversation (up to its latest 200 messages)."""
        if not self.conv:
            QMessageBox.information(self, "匯出 Word", "請先選擇一個對話。")
            return
        try:
            with busy():
                messages = self.api.messages(self.conv, 0, 200).get("messages", [])
        except ApiError as error:
            show_error(self, error)
            return
        title = self.heading.text().strip().split("　")[0]
        safe = re.sub(r'[\\/:*?"<>|]', "_", title)[:40]
        path = docx_path(self, f"對話紀錄-{safe}.docx")
        if not path:
            return
        document = Document(title)
        document.title_block(f"對話紀錄：{raw(title)}", export_info(self.user, self.api.base_url) + f"・{len(messages)} 則")
        day = ""
        for message in messages:
            stamp = when(message.get("createdAt", ""))
            moment = local_day(message.get("createdAt", ""))
            if moment != day:
                day = moment
                document.heading(day, 3)
            author = raw(message.get("authorName") or message.get("author", ""))
            text = "（訊息已刪除）" if message.get("deleted") else raw(message.get("text", ""))
            document.paragraph(f"**{author}**　{stamp}{'（已編輯）' if message.get('editedAt') and not message.get('deleted') else ''}\n{text}")
        save_docx(self, document, path)


# ───────────────────────────── 公告 ─────────────────────────────

class AnnouncementDialog(QDialog):
    def __init__(self, parent, item: dict | None = None):
        super().__init__(parent)
        item = item or {}
        self.setWindowTitle("修改公告" if item else "發布公告")
        self.title = QLineEdit(item.get("title", ""))
        self.title.setMaxLength(120)
        self.content = QPlainTextEdit(item.get("content", ""))
        self.audience = QComboBox()
        self.audience.addItem("全體社員", "all")
        self.audience.addItem("幹部限定", "officers")
        self.audience.setCurrentIndex(1 if item.get("audience") == "officers" else 0)
        self.pinned = QCheckBox("置頂")
        self.pinned.setChecked(bool(item.get("pinned")))
        self.push = QCheckBox("同步外部推播（社長已啟用時；幹部限定公告不會推播）")
        self.push.setChecked(True)
        self.push.setVisible(not item)
        form = QFormLayout()
        form.addRow("標題：", self.title)
        form.addRow("對象：", self.audience)
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(QLabel("內容："))
        layout.addWidget(self.content, 1)
        layout.addWidget(self.pinned)
        layout.addWidget(self.push)
        layout.addWidget(dialog_buttons(self))
        self.resize(520, 420)

    def accept(self) -> None:
        if not self.title.text().strip() or not self.content.toPlainText().strip():
            QMessageBox.warning(self, "公告", "請填寫標題與內容。")
            return
        super().accept()

    def values(self) -> dict:
        return {"title": self.title.text().strip(), "content": self.content.toPlainText().strip(), "audience": self.audience.currentData(),
                "pinned": self.pinned.isChecked(), "push": self.push.isChecked()}


class AnnouncementsPage(Page):
    title = "社團公告"
    icon_name = "announce"
    export_name = "社團公告.csv"

    def __init__(self, *args):
        super().__init__(*args)
        self.officer = can_view_cms(self.role)
        splitter = QSplitter(Qt.Vertical)
        columns = [("", lambda a: "📌" if a.get("pinned") else ""), ("狀態", lambda a: "" if a.get("read") else "● 未讀"),
                   ("日期", lambda a: when(a.get("createdAt", ""))), ("標題", "title"), ("發布者", "createdByName"),
                   ("對象", lambda a: "幹部限定" if a.get("audience") == "officers" else "全體社員")]
        if self.officer:
            columns.append(("已讀", "readCount"))
        self.table = DataTable(columns)
        self.table.itemSelectionChanged.connect(self.show_item)
        self.detail = QTextBrowser()
        self.detail.setOpenExternalLinks(True)
        splitter.addWidget(self.table)
        splitter.addWidget(self.detail)
        splitter.setSizes([260, 260])
        self.body.addWidget(splitter, 1)
        add = icon_button("發布公告(&N)...", "add")
        add.clicked.connect(self.add)
        edit = icon_button("修改...", "edit")
        edit.clicked.connect(self.edit)
        remove = icon_button("刪除", "delete")
        remove.clicked.connect(self.remove)
        for button in (add, edit, remove):
            button.setVisible(self.officer)
        buttons = [add, edit, remove]
        if can_manage_users(self.role):
            push = icon_button("外部推播設定...", "publish")
            push.clicked.connect(lambda: PushSettingsDialog(self, self.api).exec())
            buttons.append(push)
        self.body.addLayout(button_row(*buttons))

    def refresh(self) -> None:
        rows = self.api.announcements()
        self.table.set_rows(rows)
        self.detail.clear()
        unread = sum(1 for a in rows if not a.get("read"))
        self.status(f"公告 {len(rows)} 則，未讀 {unread} 則")

    def show_item(self) -> None:
        item = self.table.current_row_data()
        if not item:
            self.detail.clear()
            return
        read_by = ""
        if self.officer and item.get("readBy"):
            read_by = f"<p style='color:#606060'>已讀：{raw(html.escape('、'.join(item['readBy'])))}</p>"
        self.detail.setHtml(f"<h3>{'📌 ' if item.get('pinned') else ''}{raw(html.escape(item['title']))}</h3>"
                            f"<p style='color:#606060'>{raw(html.escape(item.get('createdByName') or item.get('createdBy', '')))}・{when(item.get('createdAt', ''))}</p>"
                            f"<p>{raw(message_html(item.get('content', '')))}</p>{read_by}")
        if not item.get("read"):
            def done(updated):
                item.update(updated)
                window = self.window()
                if hasattr(window, "check_messages"):
                    window.check_messages()
            background(lambda: self.api.read_announcement(item["id"]), done, lambda _e: None)

    def export_docx(self) -> None:
        """All announcements shown, with their full text (and read counts for officers)."""
        items = self.table.rows
        if not items:
            QMessageBox.information(self, "匯出 Word", "目前沒有公告。")
            return
        path = docx_path(self, "社團公告.docx")
        if not path:
            return
        document = Document("社團公告")
        document.title_block("北科無人機社 社團公告", export_info(self.user, self.api.base_url))
        for item in items:
            document.heading(("📌 " if item.get("pinned") else "") + raw(item.get("title", "")), 2)
            extra = f"・已讀 {item.get('readCount', 0)} 人" if self.officer else ""
            audience = "幹部限定" if item.get("audience") == "officers" else "全體社員"
            document.paragraph(f"{raw(item.get('createdByName') or item.get('createdBy', ''))}・{when(item.get('createdAt', ''))}・{audience}{extra}", size=18)
            for line in (item.get("content") or "").splitlines():
                document.paragraph(raw(line))
        save_docx(self, document, path)

    def add(self) -> None:
        dialog = AnnouncementDialog(self)
        if dialog.exec() != QDialog.Accepted:
            return
        try:
            with busy():
                result = self.api.create_announcement(dialog.values())
        except ApiError as error:
            show_error(self, error)
            return
        pushed = [p for p in result.get("push", [])]
        if pushed:
            QMessageBox.information(self, "外部推播", "\n".join(f"{p['target']}：{'成功' if p['result'] == 'sent' else p['result']}" for p in pushed))
        self.safe_refresh()

    def edit(self) -> None:
        item = self.table.current_row_data()
        if not item:
            return
        dialog = AnnouncementDialog(self, item)
        if dialog.exec() != QDialog.Accepted:
            return
        values = dialog.values()
        values.pop("push", None)
        try:
            with busy():
                self.api.update_announcement(item["id"], values)
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()

    def remove(self) -> None:
        item = self.table.current_row_data()
        if not item or not confirm(self, f"確定刪除公告「{item['title']}」？"):
            return
        try:
            with busy():
                self.api.delete_announcement(item["id"])
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()


# ───────────────────────────── 外部推播 ─────────────────────────────

class PushSettingsDialog(QDialog):
    """Optional module: forward announcements (and new posts) to Discord/Slack/Google Chat/Teams/LINE."""

    def __init__(self, parent, api):
        super().__init__(parent)
        self.api = api
        self.setWindowTitle("外部推播設定（選用模組）")
        intro = QLabel("預設關閉。啟用後，給「全體社員」的公告（以及可選的網站新文章）會同步發送到下列平台。"
                       "幹部限定公告與聊天內容永遠不會外流。已儲存的網址會遮蔽顯示，不修改就保留原值。")
        intro.setWordWrap(True)
        self.enabled = QCheckBox("啟用外部推播")
        self.announcements = QCheckBox("推播「全體社員」公告")
        self.posts = QCheckBox("推播網站新文章")
        self.rows = []
        hooks = QGroupBox("Webhook（Discord 頻道設定 → 整合 → Webhook；Slack／Google Chat／Teams 的 Incoming Webhook）")
        grid = QGridLayout(hooks)
        grid.addWidget(QLabel("名稱"), 0, 0)
        grid.addWidget(QLabel("網址"), 0, 1)
        for index in range(5):
            label, url = QLineEdit(), QLineEdit()
            label.setPlaceholderText("例如 Discord 社團")
            url.setPlaceholderText("https://discord.com/api/webhooks/…")
            grid.addWidget(label, index + 1, 0)
            grid.addWidget(url, index + 1, 1)
            self.rows.append((label, url))
        grid.setColumnStretch(1, 1)
        self.line = QLineEdit()
        self.line.setPlaceholderText("LINE 官方帳號 Messaging API 的 Channel access token（會廣播給所有好友，留空不使用）")
        layout = QVBoxLayout(self)
        layout.addWidget(intro)
        layout.addWidget(self.enabled)
        layout.addWidget(self.announcements)
        layout.addWidget(self.posts)
        layout.addWidget(hooks)
        layout.addWidget(QLabel("LINE Channel access token："))
        layout.addWidget(self.line)
        test = icon_button("發送測試訊息", "publish")
        test.clicked.connect(self.test)
        save = icon_button("儲存", "save")
        save.clicked.connect(self.save)
        close = icon_button("關閉", "cross")
        close.clicked.connect(self.reject)
        layout.addLayout(button_row(test, save, close, stretch_first=True))
        self.resize(640, 460)
        self.load()

    def load(self) -> None:
        try:
            with busy():
                settings = self.api.push_settings()
        except ApiError as error:
            show_error(self, error)
            return
        self.enabled.setChecked(settings.get("enabled", False))
        self.announcements.setChecked(settings.get("announcements", True))
        self.posts.setChecked(settings.get("posts", False))
        for (label, url), hook in zip(self.rows, settings.get("webhooks", []) + [{}] * 5):
            label.setText(hook.get("label", ""))
            url.setText(hook.get("url", ""))
        self.line.setText(settings.get("lineToken", ""))

    def save(self) -> None:
        webhooks = [{"label": label.text().strip(), "url": url.text().strip()} for label, url in self.rows if url.text().strip()]
        try:
            with busy():
                self.api.save_push_settings({"enabled": self.enabled.isChecked(), "announcements": self.announcements.isChecked(),
                                             "posts": self.posts.isChecked(), "webhooks": webhooks, "lineToken": self.line.text().strip()})
        except ApiError as error:
            show_error(self, error)
            return
        QMessageBox.information(self, "外部推播", "設定已儲存。")
        self.load()

    def test(self) -> None:
        try:
            with busy():
                results = self.api.push_test().get("results", [])
        except ApiError as error:
            show_error(self, error)
            return
        QMessageBox.information(self, "推播測試", "\n".join(f"{r['target']}：{'成功' if r['result'] == 'sent' else r['result']}" for r in results)
                                or "沒有設定任何推播目的地。")
