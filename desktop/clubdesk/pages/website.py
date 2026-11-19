"""社團網站管理: 文章管理, 頁面管理, 首頁設定 — the website's public content.

Same back end as the website's admin panels (/api/posts, /api/pages,
/api/homepage). Extras over the web version: drafts saved on this computer,
import/export of Markdown files, backup of every article to a folder, a
YouTube thumbnail inserter, table builder, word count and a homepage
settings backup file.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime

from PySide6.QtCore import QSettings, Qt, QTimer
from PySide6.QtGui import QAction, QKeySequence, QTextCursor
from PySide6.QtWidgets import (QApplication, QCheckBox, QComboBox, QDialog, QDialogButtonBox, QFileDialog,
                               QFormLayout, QGridLayout, QGroupBox, QHBoxLayout, QInputDialog, QLabel,
                               QLineEdit, QMessageBox, QPlainTextEdit, QPushButton, QScrollArea, QSpinBox,
                               QSplitter, QTabWidget, QTextBrowser, QToolBar, QVBoxLayout, QWidget)

from ..api import ApiError, can_edit_cms
from ..icons import icon
from ..docx import Document
from ..i18n import raw
from ..widgets import (DataTable, Page, background, busy, button_row, confirm, docx_path, export_info, icon_button,
                       open_url, save_docx, show_error)

LANGS = [("zh", "中文"), ("en", "English")]
SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$")

PREVIEW_CSS = """
<style>
body { font-family: 'PMingLiU', 'MingLiU', serif; font-size: 10pt; color: #000; }
h1 { font-size: 16pt; } h2 { font-size: 14pt; } h3 { font-size: 12pt; }
pre { background: #F2F1EC; border: 1px solid #A0A0A0; padding: 6px; }
code { background: #F2F1EC; } blockquote { color: #404040; border-left: 3px solid #A0A0A0; margin-left: 4px; padding-left: 8px; }
table { border-collapse: collapse; } th, td { border: 1px solid #808080; padding: 2px 6px; } th { background: #D4D0C8; }
</style>
"""


def slugify(title: str) -> str:
    """URL slug from a title: English words are kept, otherwise a date-based slug."""
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60].strip("-")
    return slug if slug and SLUG.match(slug) else datetime.now().strftime("post-%Y%m%d-%H%M")


def word_count(text: str) -> int:
    """CJK characters count one each; Latin words count one each (like word processors)."""
    cjk = len(re.findall(r"[㐀-鿿豈-﫿]", text))
    words = len(re.findall(r"[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*", text))
    return cjk + words


def youtube_id(url: str) -> str:
    match = re.search(r"(?:youtu\.be/|youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/))([\w-]{11})", url)
    return match.group(1) if match else ""


def front_matter(fields: dict) -> str:
    """Markdown file with a small header so it can be imported again."""
    head = ["---"] + [f"{key}: {json.dumps(fields.get(key, ''), ensure_ascii=False)}" for key in ("title", "slug", "lang", "summary", "date") if fields.get(key)]
    return "\n".join(head + ["---", "", fields.get("content", "")])


def parse_front_matter(text: str) -> dict:
    text = text.lstrip("﻿")
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?", text, re.S)
    if not match:
        title = re.search(r"^#\s+(.+)$", text, re.M)
        return {"content": text, "title": title.group(1).strip() if title else ""}
    fields = {}
    for line in match.group(1).splitlines():
        key, _, value = line.partition(":")
        value = value.strip()
        try:
            fields[key.strip()] = json.loads(value)
        except ValueError:
            fields[key.strip()] = value.strip("'\"")
    fields["content"] = text[match.end():]
    return fields


# ───────────────────────────── Markdown editor ─────────────────────────────

class TableDialog(QDialog):
    def __init__(self, parent):
        super().__init__(parent)
        self.setWindowTitle("插入表格")
        self.rows = QSpinBox()
        self.rows.setRange(1, 30)
        self.rows.setValue(3)
        self.cols = QSpinBox()
        self.cols.setRange(1, 10)
        self.cols.setValue(3)
        form = QFormLayout(self)
        form.addRow("資料列數：", self.rows)
        form.addRow("欄數：", self.cols)
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        form.addRow(buttons)

    def markdown(self) -> str:
        cols = self.cols.value()
        lines = ["| " + " | ".join(f"標題{i + 1}" for i in range(cols)) + " |", "|" + " --- |" * cols]
        lines += ["| " + " | ".join("內容" for _ in range(cols)) + " |" for _ in range(self.rows.value())]
        return "\n".join(lines)


class MarkdownEditor(QWidget):
    """Markdown text with a formatting toolbar and a live preview rendered by the website itself."""

    def __init__(self, api, parent=None):
        super().__init__(parent)
        self.api = api
        self.toolbar = QToolBar()
        self.toolbar.setIconSize(self.toolbar.iconSize().scaled(16, 16, Qt.KeepAspectRatio))
        self.edit = QPlainTextEdit()
        self.edit.setTabChangesFocus(False)
        self.edit.setPlaceholderText("在這裡用 Markdown 撰寫內容。上方工具列可插入粗體、標題、清單、連結、圖片、表格與 YouTube 影片。")
        self.preview = QTextBrowser()
        self.preview.setOpenExternalLinks(True)
        self.live = QCheckBox("即時預覽")
        self.live.setChecked(True)
        self.live.toggled.connect(self.preview_toggled)
        self.counter = QLabel()
        self.counter.setObjectName("Total")
        splitter = QSplitter(Qt.Horizontal)
        splitter.addWidget(self.edit)
        splitter.addWidget(self.preview)
        splitter.setSizes([520, 420])
        self.splitter = splitter

        tools = [
            ("md-bold", "粗體 (Ctrl+B)", lambda: self.wrap("**", "**", "粗體文字"), "Ctrl+B"),
            ("md-italic", "斜體 (Ctrl+I)", lambda: self.wrap("*", "*", "斜體文字"), "Ctrl+I"),
            ("md-strike", "刪除線", lambda: self.wrap("~~", "~~", "刪除線"), None),
            None,
            ("md-h1", "大標題", lambda: self.line_prefix("# "), "Ctrl+1"),
            ("md-h2", "二級標題", lambda: self.line_prefix("## "), "Ctrl+2"),
            ("md-h3", "三級標題", lambda: self.line_prefix("### "), "Ctrl+3"),
            None,
            ("md-quote", "引用", lambda: self.line_prefix("> "), None),
            ("md-list", "項目清單", lambda: self.line_prefix("- "), None),
            ("md-olist", "編號清單", lambda: self.line_prefix("1. "), None),
            ("md-task", "待辦清單", lambda: self.line_prefix("- [ ] "), None),
            None,
            ("md-code", "行內程式碼", lambda: self.wrap("`", "`", "code"), None),
            ("md-codeblock", "程式碼區塊", lambda: self.wrap("\n```\n", "\n```\n", "程式碼"), None),
            ("md-link", "插入連結 (Ctrl+K)", self.insert_link, "Ctrl+K"),
            ("md-image", "插入圖片", self.insert_image, None),
            ("md-video", "插入 YouTube 影片", self.insert_video, None),
            ("md-table", "插入表格", self.insert_table, None),
            ("md-hr", "分隔線", lambda: self.insert_block("\n---\n"), None),
        ]
        for tool in tools:
            if tool is None:
                self.toolbar.addSeparator()
                continue
            name, tip, slot, shortcut = tool
            act = QAction(icon(name), tip, self)
            act.setToolTip(tip)
            act.triggered.connect(slot)
            if shortcut:
                act.setShortcut(QKeySequence(shortcut))
                act.setShortcutContext(Qt.WidgetWithChildrenShortcut)
            self.toolbar.addAction(act)
        self.toolbar.addSeparator()
        self.toolbar.addWidget(self.live)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(2)
        layout.addWidget(self.toolbar)
        layout.addWidget(splitter, 1)
        layout.addWidget(self.counter, 0, Qt.AlignRight)

        self.timer = QTimer(self)
        self.timer.setSingleShot(True)
        self.timer.setInterval(700)
        self.timer.timeout.connect(self.render_preview)
        self.edit.textChanged.connect(self.changed)
        self._generation = 0
        self.changed()

    # ------------------------------------------------------------ editing
    def text(self) -> str:
        return self.edit.toPlainText()

    def set_text(self, value: str) -> None:
        self.edit.setPlainText(value or "")

    def wrap(self, before: str, after: str, placeholder: str) -> None:
        cursor = self.edit.textCursor()
        selected = cursor.selectedText().replace(" ", "\n") or placeholder
        cursor.insertText(f"{before}{selected}{after}")
        if not cursor.hasSelection() and selected == placeholder:
            cursor.movePosition(QTextCursor.Left, QTextCursor.MoveAnchor, len(after))
            cursor.movePosition(QTextCursor.Left, QTextCursor.KeepAnchor, len(placeholder))
            self.edit.setTextCursor(cursor)
        self.edit.setFocus()

    def line_prefix(self, prefix: str) -> None:
        cursor = self.edit.textCursor()
        start, end = sorted((cursor.selectionStart(), cursor.selectionEnd()))
        cursor.setPosition(start)
        cursor.movePosition(QTextCursor.StartOfBlock)
        cursor.beginEditBlock()
        while True:
            cursor.insertText(prefix)
            end += len(prefix)
            if not cursor.movePosition(QTextCursor.NextBlock) or cursor.position() > end:
                break
        cursor.endEditBlock()
        self.edit.setFocus()

    def insert_block(self, markdown: str) -> None:
        cursor = self.edit.textCursor()
        cursor.insertText(markdown)
        self.edit.setFocus()

    def insert_link(self) -> None:
        selected = self.edit.textCursor().selectedText()
        url, ok = QInputDialog.getText(self, "插入連結", "網址（https://...）：", text="https://")
        if ok and url.strip():
            self.edit.textCursor().insertText(f"[{selected or '連結文字'}]({url.strip()})")

    def insert_image(self) -> None:
        url, ok = QInputDialog.getText(self, "插入圖片", "圖片網址（https://... 或網站上的 /assets/images/...）：", text="https://")
        if not ok or not url.strip():
            return
        alt, ok = QInputDialog.getText(self, "插入圖片", "圖片說明（替代文字）：", text="圖片")
        self.insert_block(f"\n![{alt if ok else '圖片'}]({url.strip()})\n")

    def insert_video(self) -> None:
        url, ok = QInputDialog.getText(self, "插入 YouTube 影片", "YouTube 影片網址：")
        if not ok or not url.strip():
            return
        video = youtube_id(url)
        if not video:
            QMessageBox.warning(self, "插入 YouTube 影片", "看不懂這個網址，請貼上 youtube.com/watch?v=… 或 youtu.be/… 的連結。")
            return
        # The website does not allow embedded players, so a clickable thumbnail is used.
        self.insert_block(f"\n[![YouTube 影片](https://img.youtube.com/vi/{video}/hqdefault.jpg)](https://www.youtube.com/watch?v={video})\n")

    def insert_table(self) -> None:
        dialog = TableDialog(self)
        if dialog.exec() == QDialog.Accepted:
            self.insert_block("\n" + dialog.markdown() + "\n")

    # ------------------------------------------------------------ preview
    def changed(self) -> None:
        text = self.text()
        count = word_count(text)
        self.counter.setText(f" 字數 {count:,}・約 {max(1, round(count / 400)) if count else 0} 分鐘讀完 ")
        if self.live.isChecked():
            self.timer.start()

    def preview_toggled(self, on: bool) -> None:
        self.preview.setVisible(on)
        if on:
            self.render_preview()

    def render_preview(self) -> None:
        text = self.text()
        if not text.strip():
            self.preview.setHtml(PREVIEW_CSS + "<p style='color:#808080'>（預覽區：輸入內容後會顯示網站上的樣子）</p>")
            return
        self._generation += 1
        generation = self._generation

        def done(html):
            if generation == self._generation:
                scroll = self.preview.verticalScrollBar().value()
                self.preview.setHtml(PREVIEW_CSS + html)
                self.preview.verticalScrollBar().setValue(scroll)

        def failed(error):
            if generation == self._generation:
                self.preview.setPlainText(f"（無法取得預覽：{error}）\n\n{text}")

        background(lambda: self.api.preview_markdown(text), done, failed)


# ───────────────────────────── Post / page editor ─────────────────────────────

class ContentEditor(QDialog):
    """Full editor window for one post or page."""

    def __init__(self, parent, api, kind: str, item: dict | None, ai_enabled: bool):
        super().__init__(parent)
        self.api = api
        self.kind = kind  # "post" or "page"
        self.noun = "文章" if kind == "post" else "頁面"
        self.original_slug = (item or {}).get("slug", "")
        self.saved = None
        self.setWindowTitle(f"修改{self.noun} - {raw(item.get('title', ''))}" if item else f"新增{self.noun}")
        self.setWindowFlag(Qt.WindowMaximizeButtonHint, True)
        self.setWindowFlag(Qt.WindowContextHelpButtonHint, False)
        self.resize(1100, 720)
        item = item or {}

        self.title = QLineEdit(item.get("title", ""))
        self.title.setPlaceholderText(f"{self.noun}標題")
        self.lang = QComboBox()
        for value, label in LANGS:
            self.lang.addItem(label, value)
        self.lang.setCurrentIndex(1 if item.get("lang") == "en" else 0)
        self.slug = QLineEdit(item.get("slug", ""))
        self.slug.setPlaceholderText("只能用英文、數字、底線或連字號，例如 fpv-setup-guide")
        auto = icon_button("自動產生", "refresh", "依標題產生網址代稱")
        auto.clicked.connect(lambda: self.slug.setText(slugify(self.title.text())))
        self.summary = QLineEdit(item.get("summary", ""))
        self.summary.setPlaceholderText("簡短說明，顯示在文章列表")
        self.url_label = QLabel()
        self.url_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.slug.textChanged.connect(self.update_url)
        self.editor = MarkdownEditor(api)
        self.editor.set_text(item.get("content", ""))

        info = QGroupBox(f"{self.noun}資訊")
        grid = QGridLayout(info)
        grid.addWidget(QLabel("標題："), 0, 0)
        grid.addWidget(self.title, 0, 1)
        grid.addWidget(QLabel("語言："), 0, 2)
        grid.addWidget(self.lang, 0, 3)
        grid.addWidget(QLabel("網址代稱："), 1, 0)
        slug_row = QHBoxLayout()
        slug_row.addWidget(self.slug, 1)
        slug_row.addWidget(auto)
        grid.addLayout(slug_row, 1, 1, 1, 3)
        row = 2
        if kind == "post":
            grid.addWidget(QLabel("摘要："), row, 0)
            grid.addWidget(self.summary, row, 1, 1, 3)
            row += 1
        grid.addWidget(QLabel("網址："), row, 0)
        grid.addWidget(self.url_label, row, 1, 1, 3)
        grid.setColumnStretch(1, 1)

        layout = QVBoxLayout(self)
        layout.addWidget(info)
        if ai_enabled:
            layout.addWidget(self.ai_box())
        layout.addWidget(self.editor, 1)

        import_md = icon_button("匯入 .md...", "import", "從 Markdown 檔案載入內容")
        import_md.clicked.connect(self.import_markdown)
        export_md = icon_button("匯出 .md...", "export-md", "把內容存成 Markdown 檔案")
        export_md.clicked.connect(self.export_markdown)
        export_word = icon_button("匯出 Word...", "word", "把內容存成 Word（.docx）文件，方便列印或交給學校")
        export_word.clicked.connect(self.export_word)
        save = icon_button("儲存(&S)", "save")
        save.setDefault(True)
        save.clicked.connect(lambda: self.save(False))
        save_open = icon_button("儲存並在網站開啟", "open-web")
        save_open.clicked.connect(lambda: self.save(True))
        cancel = icon_button("取消", "cross")
        cancel.clicked.connect(self.reject)
        buttons = QHBoxLayout()
        buttons.addWidget(import_md)
        buttons.addWidget(export_md)
        buttons.addWidget(export_word)
        self.draft_label = QLabel()
        self.draft_label.setStyleSheet("color: #404040;")
        buttons.addWidget(self.draft_label, 1)
        for button in (save, save_open, cancel):
            buttons.addWidget(button)
        layout.addLayout(buttons)

        # Drafts are kept on this computer every 20 seconds, so a crash or a lost
        # connection never loses an article.
        self.draft_key = f"drafts/{kind}/{self.original_slug or 'new'}"
        self.autosave = QTimer(self)
        self.autosave.setInterval(20000)
        self.autosave.timeout.connect(self.save_draft)
        self.autosave.start()
        self.offer_draft()
        self.update_url()
        self.title.setFocus()

    def ai_box(self) -> QGroupBox:
        box = QGroupBox("AI 寫作助理（每次使用會扣每日 AI 次數）")
        row = QHBoxLayout(box)
        self.ai_notes = QLineEdit()
        self.ai_notes.setPlaceholderText("給 AI 的重點或要求，例如：期末成果展、12/20 在中正館、歡迎新生參加")
        row.addWidget(self.ai_notes, 1)
        for action, label, tip in (("draft", "依重點草擬", "依上面的重點寫一篇完整內容"), ("polish", "潤飾", "修順語句、改錯字"),
                                   ("summary", "產生摘要", "依內文寫摘要"), ("translate", "翻譯成另一語言", "另存成另一語言的新文章")):
            button = icon_button(label, "ai", tip)
            button.clicked.connect(lambda _=False, a=action: self.run_ai(a))
            row.addWidget(button)
        return box

    def fields(self) -> dict:
        data = {"title": self.title.text().strip(), "lang": self.lang.currentData(), "slug": self.slug.text().strip(),
                "content": self.editor.text()}
        if self.kind == "post":
            data["summary"] = self.summary.text().strip()
        return data

    def fill(self, data: dict) -> None:
        if data.get("title"):
            self.title.setText(data["title"])
        if data.get("summary") is not None and self.kind == "post":
            self.summary.setText(data.get("summary", ""))
        if data.get("content"):
            self.editor.set_text(data["content"])
        if data.get("lang") in ("zh", "en"):
            self.lang.setCurrentIndex(1 if data["lang"] == "en" else 0)
        if data.get("slug") and (not self.slug.text().strip() or data.get("force_slug")):
            self.slug.setText(data["slug"])

    def update_url(self) -> None:
        slug = self.slug.text().strip() or "（網址代稱）"
        self.url_label.setText(f"{self.api.base_url}/{'blog' if self.kind == 'post' else 'page'}/{slug}")

    # --------------------------------------------------------------- AI
    def run_ai(self, action: str) -> None:
        current = self.fields()
        if action == "draft" and not self.ai_notes.text().strip():
            QMessageBox.information(self, "AI 寫作助理", "請先在左邊輸入重點，AI 會依重點草擬內容。")
            return
        if action != "draft" and not current["content"].strip():
            QMessageBox.information(self, "AI 寫作助理", "請先輸入內容。")
            return
        if action == "translate" and not confirm(self, f"翻譯後會變成另一語言的新{self.noun}，儲存時另存新檔，原本的{self.noun}不受影響。繼續？"):
            return
        try:
            with busy():
                result = self.api.ai_content(action, {"title": current["title"], "summary": current.get("summary", ""),
                                                      "content": current["content"], "lang": current["lang"]}, self.ai_notes.text())
        except ApiError as error:
            show_error(self, error, "AI 寫作助理")
            return
        if action == "translate":
            slug = result.get("slug") or ""
            if not slug or slug == current["slug"]:
                slug = f"{current['slug'] or 'article'}-{result.get('lang', 'en')}"
            self.original_slug = ""
            self.draft_key = f"drafts/{self.kind}/new"
            self.setWindowTitle(f"新增{self.noun}（{'英文' if result.get('lang') == 'en' else '中文'}翻譯版）")
            result = {**result, "slug": slug, "force_slug": True}
        self.fill(result)
        QMessageBox.information(self, "AI 寫作助理", ("AI 備註：" + result["notes"]) if result.get("notes") else "已填入，請檢查後再儲存。")

    # ------------------------------------------------------------ drafts
    def save_draft(self) -> None:
        data = self.fields()
        if data["title"] or data["content"].strip():
            QSettings().setValue(self.draft_key, json.dumps({**data, "savedAt": datetime.now().strftime("%Y-%m-%d %H:%M")}, ensure_ascii=False))
            self.draft_label.setText(f"草稿已自動保存於本機（{datetime.now().strftime('%H:%M:%S')}）")

    def offer_draft(self) -> None:
        raw = QSettings().value(self.draft_key, "", str)
        if not raw:
            return
        try:
            draft = json.loads(raw)
        except ValueError:
            return
        if draft.get("content") == self.editor.text() and draft.get("title") == self.title.text():
            return
        if confirm(self, f"找到 {draft.get('savedAt', '')} 自動保存的草稿「{draft.get('title') or '未命名'}」，要還原嗎？", "還原草稿"):
            self.fill({**draft, "force_slug": True})

    def clear_draft(self) -> None:
        QSettings().remove(self.draft_key)

    # ------------------------------------------------------------- files
    def import_markdown(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "匯入 Markdown", "", "Markdown (*.md *.markdown *.txt)")
        if not path:
            return
        with open(path, encoding="utf-8-sig") as handle:
            data = parse_front_matter(handle.read())
        if not data.get("slug") and data.get("title"):
            data["slug"] = slugify(data["title"])
        self.fill(data)

    def export_markdown(self) -> None:
        data = self.fields()
        name = data["slug"] or slugify(data["title"])
        path, _ = QFileDialog.getSaveFileName(self, "匯出 Markdown", f"{name}.md", "Markdown (*.md)")
        if path:
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(front_matter(data))

    def export_word(self) -> None:
        data = self.fields()
        if not data["content"].strip():
            QMessageBox.information(self, "匯出 Word", "請先輸入內容。")
            return
        path = docx_path(self, f"{data['slug'] or slugify(data['title'])}.docx")
        if path:
            save_docx(self, content_document(data, self.kind, self.api.base_url), path)

    # -------------------------------------------------------------- save
    def save(self, open_after: bool) -> None:
        data = self.fields()
        if not data["title"] or not data["content"].strip():
            QMessageBox.warning(self, "資料不完整", "請填寫標題與內容。")
            return
        if not data["slug"]:
            data["slug"] = slugify(data["title"])
            self.slug.setText(data["slug"])
        if not SLUG.match(data["slug"]):
            QMessageBox.warning(self, "網址代稱", "網址代稱只能使用英文字母、數字、底線或連字號，且需以英數字開頭。")
            self.slug.setFocus()
            return
        try:
            with busy():
                save = self.api.save_post if self.kind == "post" else self.api.save_page
                result = save(data, self.original_slug)
        except ApiError as error:
            show_error(self, error)
            return
        self.saved = result.get(self.kind, data)
        self.autosave.stop()
        self.clear_draft()
        pushed = [p for p in result.get("push", []) if p.get("result") == "sent"]
        if pushed:
            QMessageBox.information(self, "外部推播", "已同步推播到：" + "、".join(p["target"] for p in pushed))
        if open_after:
            open_url(self, f"{self.api.base_url}/{'blog' if self.kind == 'post' else 'page'}/{data['slug']}")
        self.accept()

    def reject(self) -> None:
        self.save_draft()
        super().reject()


def content_document(data: dict, kind: str, base_url: str) -> Document:
    """A post or page as a Word document: title, details line, summary and the Markdown body."""
    document = Document(data.get("title", ""))
    url = f"{base_url}/{'blog' if kind == 'post' else 'page'}/{data.get('slug', '')}"
    details = "・".join(x for x in ((data.get("date") or "")[:10], "English" if data.get("lang") == "en" else "中文", url) if x)
    document.title_block(raw(data.get("title", "")), details)
    if data.get("summary"):
        document.quote(data["summary"])
    document.markdown(data.get("content", ""))
    return document


# ───────────────────────────── Lists ─────────────────────────────

class ContentPage(Page):
    """Shared list for 文章管理 and 頁面管理."""

    kind = "post"
    noun = "文章"
    url_prefix = "blog"

    def __init__(self, *args):
        super().__init__(*args)
        self.items: list[dict] = []
        self.ai_enabled = False
        search = QGroupBox("查詢條件")
        row = QHBoxLayout(search)
        self.query = QLineEdit()
        self.query.setPlaceholderText("標題、網址代稱或摘要")
        self.query.textChanged.connect(self.apply_filter)
        self.lang = QComboBox()
        self.lang.addItem("（全部語言）", "")
        for value, label in LANGS:
            self.lang.addItem(label, value)
        self.lang.setSizeAdjustPolicy(QComboBox.AdjustToContents)
        self.lang.currentIndexChanged.connect(self.apply_filter)
        row.addWidget(QLabel("關鍵字："))
        row.addWidget(self.query, 1)
        row.addWidget(QLabel("語言："))
        row.addWidget(self.lang)
        self.body.addWidget(search)
        columns = [("標題", "title"), ("語言", lambda r: "English" if r.get("lang") == "en" else "中文"),
                   ("網址", lambda r: f"/{self.url_prefix}/{r.get('slug', '')}")]
        if self.kind == "post":
            columns = [("日期", lambda r: (r.get("date") or "")[:10])] + columns + [("摘要", "summary")]
        self.table = DataTable(columns)
        self.table.doubleClicked.connect(self.edit)
        self.body.addWidget(self.table, 1)
        self.editable = can_edit_cms(self.role)
        self.add_button = icon_button("新增(&N)...", "add")
        self.add_button.clicked.connect(self.add)
        self.edit_button = icon_button("修改(&E)...", "edit")
        self.edit_button.clicked.connect(self.edit)
        self.delete_button = icon_button("刪除(&D)", "delete")
        self.delete_button.clicked.connect(self.remove)
        view = icon_button("在網站開啟", "open-web")
        view.clicked.connect(self.view_online)
        copy = icon_button("複製網址", "copy")
        copy.clicked.connect(self.copy_url)
        backup = icon_button("全部備份成 .md...", "export-md", f"把所有{self.noun}存成 Markdown 檔案到一個資料夾")
        backup.clicked.connect(self.backup)
        for button in (self.add_button, self.edit_button, self.delete_button):
            button.setEnabled(self.editable)
        self.body.addLayout(button_row(self.add_button, self.edit_button, self.delete_button, view, copy, backup))
        if not self.editable:
            self.body.addWidget(QLabel(f"您的角色可以查看{self.noun}，修改需要社長或幹部權限。"))

    def load_items(self) -> list:
        raise NotImplementedError

    def get_item(self, slug: str) -> dict:
        raise NotImplementedError

    def delete_item(self, slug: str) -> None:
        raise NotImplementedError

    def refresh(self) -> None:
        self.items = self.load_items()
        try:
            self.ai_enabled = bool(self.api.ai_status().get("enabled"))
        except ApiError:
            self.ai_enabled = False
        self.apply_filter()

    def apply_filter(self) -> None:
        query = self.query.text().strip().lower()
        lang = self.lang.currentData()
        rows = [item for item in self.items
                if (not lang or (item.get("lang") or "zh") == lang)
                and (not query or query in " ".join(str(item.get(k, "")) for k in ("title", "slug", "summary")).lower())]
        self.table.set_rows(rows)
        self.status(f"{self.noun} {len(rows)} 篇" + (f"（共 {len(self.items)} 篇）" if len(rows) != len(self.items) else ""))

    def selected(self) -> dict | None:
        item = self.table.current_row_data()
        if not item:
            QMessageBox.information(self, self.title, f"請先選取一篇{self.noun}。")
        return item

    def open_editor(self, item: dict | None) -> None:
        editor = ContentEditor(self, self.api, self.kind, item, self.ai_enabled)
        if editor.exec() == QDialog.Accepted:
            self.safe_refresh()
            self.status(f"{self.noun}已儲存，網站立即生效")

    def add(self) -> None:
        self.open_editor(None)

    def edit(self) -> None:
        item = self.selected()
        if not item:
            return
        try:
            with busy():
                full = self.get_item(item["slug"])
        except ApiError as error:
            show_error(self, error)
            return
        if not self.editable:
            ContentViewer(self, full).exec()
            return
        self.open_editor(full)

    def remove(self) -> None:
        item = self.selected()
        if not item or not confirm(self, f"確定刪除{self.noun}「{item.get('title')}」？網站上會立即消失，無法復原。\n（建議先用「全部備份成 .md」備份）"):
            return
        try:
            with busy():
                self.delete_item(item["slug"])
        except ApiError as error:
            show_error(self, error)
            return
        self.safe_refresh()

    def item_url(self, item: dict) -> str:
        return f"{self.api.base_url}/{self.url_prefix}/{item.get('slug', '')}"

    def view_online(self) -> None:
        item = self.selected()
        if item:
            open_url(self, self.item_url(item))

    def copy_url(self) -> None:
        item = self.selected()
        if item:
            QApplication.clipboard().setText(self.item_url(item))
            self.status("網址已複製到剪貼簿")

    def export_docx(self) -> None:
        """The selected post/page in full; with nothing selected, the list as a table."""
        item = self.table.current_row_data()
        if not item:
            super().export_docx()
            return
        try:
            with busy():
                full = {**item, **self.get_item(item["slug"])}
        except ApiError as error:
            show_error(self, error)
            return
        path = docx_path(self, f"{item['slug']}.docx")
        if path:
            save_docx(self, content_document(full, self.kind, self.api.base_url), path)

    def backup(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, f"選擇備份{self.noun}的資料夾")
        if not folder:
            return
        count = 0
        try:
            with busy():
                for item in self.items:
                    full = self.get_item(item["slug"])
                    with open(os.path.join(folder, f"{item['slug']}.md"), "w", encoding="utf-8") as handle:
                        handle.write(front_matter({**item, **full}))
                    count += 1
        except (ApiError, OSError) as error:
            QMessageBox.warning(self, "備份未完成", f"備份中斷：{error}\n\n只備份了 {count} / {len(self.items)} 篇{self.noun}到\n{folder}\n請確認連線後重新備份。")
            return
        QMessageBox.information(self, "備份完成", f"已備份 {count} 篇{self.noun}到\n{folder}")


class ContentViewer(QDialog):
    def __init__(self, parent, item: dict):
        super().__init__(parent)
        self.setWindowTitle(raw(item.get("title", "")))
        self.resize(700, 560)
        text = QPlainTextEdit(item.get("content", ""))
        text.setReadOnly(True)
        layout = QVBoxLayout(self)
        layout.addWidget(text)
        buttons = QDialogButtonBox(QDialogButtonBox.Close)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)


class PostsPage(ContentPage):
    title = "文章管理"
    icon_name = "posts"
    export_name = "網站文章.csv"
    kind, noun, url_prefix = "post", "文章", "blog"

    def load_items(self):
        return self.api.posts()

    def get_item(self, slug):
        return self.api.get_post(slug)

    def delete_item(self, slug):
        self.api.delete_post(slug)


class PagesPage(ContentPage):
    title = "頁面管理"
    icon_name = "pages"
    export_name = "網站頁面.csv"
    kind, noun, url_prefix = "page", "頁面", "page"

    def load_items(self):
        return self.api.pages()

    def get_item(self, slug):
        return self.api.get_page(slug)

    def delete_item(self, slug):
        self.api.delete_page(slug)


# ───────────────────────────── Homepage settings ─────────────────────────────

# (section, [(key, label, default shown as placeholder, multi-line)])
HOMEPAGE_SECTIONS = [
    ("主視覺", [
        ("heroTitle", "首頁主標題", "北科無人機社", False),
        ("heroDesc", "主視覺說明文字", "探索上帝視角的無限精彩…", True),
        ("heroBadge", "頂部徽章文字", "國立臺北科技大學 | 學務處課外活動指導組核可康樂性社團", False),
    ]),
    ("關於我們", [
        ("aboutTitle", "區塊標題", "關於北科無人機社", False),
        ("aboutSubtitle", "區塊副標題", "我們不僅僅是在空中飛行…", False),
        ("aboutCard1Title", "卡片 1 標題", "安全第一的飛行教育", False), ("aboutCard1Desc", "卡片 1 內容", "", True),
        ("aboutCard2Title", "卡片 2 標題", "動手實作的創客精神", False), ("aboutCard2Desc", "卡片 2 內容", "", True),
        ("aboutCard3Title", "卡片 3 標題", "緊密的飛友社群", False), ("aboutCard3Desc", "卡片 3 內容", "", True),
    ]),
    ("四大特色", [
        ("featuresTitle", "區塊標題", "四大核心特色", False),
        ("featuresSubtitle", "區塊副標題", "從模擬訓練到實機操作…", False),
        ("feat1Title", "特色 1 標題", "模擬器飛行訓練", False), ("feat1Desc", "特色 1 描述", "", True),
        ("feat2Title", "特色 2 標題", "FPV 穿越機飛行", False), ("feat2Desc", "特色 2 描述", "", True),
        ("feat3Title", "特色 3 標題", "空拍與視覺創作", False), ("feat3Desc", "特色 3 描述", "", True),
        ("feat4Title", "特色 4 標題", "考照與組裝特訓", False), ("feat4Desc", "特色 4 描述", "", True),
    ]),
    ("頁尾與社群連結", [
        ("ctaTitle", "號召區塊標題", "準備好起飛了嗎？", False),
        ("ctaDesc", "號召區塊內文", "立即加入北科無人機社 LINE 官方社群…", False),
        ("lineLink", "LINE 社群網址", "https://lin.ee/...", False),
        ("igLink", "Instagram 網址", "https://www.instagram.com/ntut_drone/", False),
        ("emailLink", "官方信箱", "ntut.droneclub@gmail.com", False),
    ]),
] + [
    (f"IG 動態卡片 {n}", [
        (f"igCard{n}Tag", "標籤名稱", tag, False),
        (f"igCard{n}Caption", "貼文文案與 Hashtags", "", True),
        (f"igCard{n}Img", "圖片網址", img, False),
        (f"igCard{n}Likes", "按讚數", likes, False),
        (f"igCard{n}Comments", "留言數", comments, False),
    ]) for n, tag, img, likes, comments in (
        (1, "FPV 穿越機", "/assets/images/fpv_drone_hero.jpg", "158", "24"),
        (2, "航拍創作", "/assets/images/logo_drone.png", "210", "19"),
        (3, "創客實作", "留空將顯示科技色圖標圖案", "135", "12"),
        (4, "飛行局日常", "留空將顯示綠色飛行圖案", "192", "31"),
    )
]
HOMEPAGE_KEYS = [key for _, fields in HOMEPAGE_SECTIONS for key, *_ in fields]


class HomepagePage(Page):
    title = "首頁設定"
    icon_name = "homepage"

    def __init__(self, *args):
        super().__init__(*args)
        self.fields: dict[str, QLineEdit | QPlainTextEdit] = {}
        self.saved: dict = {}
        hint = QLabel("留空的欄位會顯示網站預設文字（灰色提示）。按「儲存」後網站首頁立即更新。")
        self.body.addWidget(hint)
        tabs = QTabWidget()
        for section, fields in HOMEPAGE_SECTIONS:
            page = QWidget()
            column = QVBoxLayout(page)
            form = QFormLayout()
            column.addLayout(form)
            column.addStretch(1)  # keep the fields together at the top
            for key, label, default, multi in fields:
                if multi:
                    edit = QPlainTextEdit()
                    edit.setFixedHeight(56)
                    edit.setPlaceholderText(default or "（網站預設內容）")
                else:
                    edit = QLineEdit()
                    edit.setPlaceholderText(default or "（網站預設內容）")
                self.fields[key] = edit
                form.addRow(label + "：", edit)
            scroll = QScrollArea()
            scroll.setWidgetResizable(True)
            scroll.setWidget(page)
            tabs.addTab(scroll, section)
        self.body.addWidget(tabs, 1)
        self.editable = can_edit_cms(self.role)
        save = icon_button("儲存(&S)", "save")
        save.clicked.connect(self.save)
        reload_ = icon_button("放棄修改", "refresh")
        reload_.clicked.connect(self.safe_refresh)
        view = icon_button("在網站預覽", "open-web")
        view.clicked.connect(lambda: open_url(self, self.api.base_url + "/"))
        export = icon_button("匯出設定檔...", "export-md", "把首頁設定存成檔案備份")
        export.clicked.connect(self.export_settings)
        import_ = icon_button("匯入設定檔...", "import", "從備份檔載入（按儲存才會生效）")
        import_.clicked.connect(self.import_settings)
        reset = icon_button("全部恢復預設", "delete", "清空所有欄位，網站改用預設文字（按儲存才會生效）")
        reset.clicked.connect(self.reset_all)
        for button in (save, import_, reset):
            button.setEnabled(self.editable)
        self.body.addLayout(button_row(save, reload_, view, export, import_, reset))

    def values(self) -> dict:
        return {key: (edit.toPlainText() if isinstance(edit, QPlainTextEdit) else edit.text()).strip()
                for key, edit in self.fields.items()}

    def set_values(self, data: dict) -> None:
        for key, edit in self.fields.items():
            value = str(data.get(key, "") or "")
            if isinstance(edit, QPlainTextEdit):
                edit.setPlainText(value)
            else:
                edit.setText(value)

    def refresh(self) -> None:
        self.saved = self.api.homepage()
        self.set_values(self.saved)
        self.status(f"首頁設定：已自訂 {sum(1 for k in HOMEPAGE_KEYS if self.saved.get(k))} 個欄位")

    def save(self) -> None:
        values = self.values()
        for key in ("lineLink", "igLink"):
            if values[key] and not values[key].startswith(("https://", "http://")):
                QMessageBox.warning(self, "網址格式", "LINE 與 Instagram 網址需以 https:// 開頭。")
                return
        try:
            with busy():
                self.api.save_homepage(values)
        except ApiError as error:
            show_error(self, error)
            return
        self.saved = values
        self.status("首頁設定已儲存，網站立即生效")
        QMessageBox.information(self, "首頁設定", "已儲存，網站首頁立即更新。")

    def export_docx(self) -> None:
        path = docx_path(self, "首頁設定.docx")
        if not path:
            return
        values = self.values()
        document = Document("首頁設定")
        document.title_block("社團網站 首頁設定", export_info(self.user, self.api.base_url))
        for section, fields in HOMEPAGE_SECTIONS:
            document.heading(section, 2)
            document.table(["欄位", "內容"], [[label, values.get(key) or f"（預設）{default}".rstrip()] for key, label, default, _ in fields])
        save_docx(self, document, path)

    def export_settings(self) -> None:
        path, _ = QFileDialog.getSaveFileName(self, "匯出首頁設定", f"首頁設定-{datetime.now():%Y%m%d}.json", "JSON (*.json)")
        if path:
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(self.values(), handle, ensure_ascii=False, indent=2)

    def import_settings(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "匯入首頁設定", "", "JSON (*.json)")
        if not path:
            return
        try:
            with open(path, encoding="utf-8-sig") as handle:
                data = json.load(handle)
        except (OSError, ValueError) as error:
            QMessageBox.warning(self, "匯入首頁設定", f"無法讀取檔案：{error}")
            return
        self.set_values({key: data.get(key, "") for key in HOMEPAGE_KEYS})
        self.status("已載入設定檔，請確認後按「儲存」")

    def reset_all(self) -> None:
        if confirm(self, "清空所有欄位？按「儲存」後網站首頁會改回預設文字。"):
            self.set_values({})
