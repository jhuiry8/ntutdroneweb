"""Interface language (繁體中文 / English).

The program's own texts are written in Traditional Chinese. When English is selected,
`tr()` swaps them for the English text in `translations_en` while the program builds its
windows, so no page needs to know about the language:

* `tr(text)` looks the whole text up first. Texts that are assembled from pieces (f-strings,
  `"..." + value`) are not in the table as a whole, so the known Chinese pieces inside them
  are replaced one by one, longest first.
* `install()` hooks the Qt widget methods that show text (labels, buttons, menus, tooltips,
  message boxes, table headers ...) so the translation happens there. Table / tree / list
  cells and combo-box entries only get exact matches, because they mostly show the server's own
  data (names, titles) that must never be altered.
* Text that comes from the server (error messages, article bodies ...) stays as it is.

The language is saved in QSettings ("language": "zh" or "en"); the environment variable
CLUBDESK_LANG overrides it for one run.
"""

from __future__ import annotations

import os
import re

LANGUAGES = {"zh": "繁體中文", "en": "English"}
DEFAULT_LANGUAGE = "zh"

_CJK = re.compile(r"[　-鿿＀-￯]")
_PUNCTUATION = str.maketrans({"：": ": ", "，": ", ", "。": ". ", "、": ", ", "？": "? ", "！": "! ", "；": "; ",
                              "（": " (", "）": ") ", "／": "/", "　": " ", "・": " · ", "「": ' "', "」": '" ',
                              "～": "-", "—": "-"})

_language = DEFAULT_LANGUAGE
_exact: dict[str, str] = {}
_pattern: re.Pattern | None = None
_phrases: list = []


def language() -> str:
    return _language


def is_english() -> bool:
    return _language == "en"


def set_language(code: str) -> None:
    """Selects the language for texts built from now on (windows already open keep theirs)."""
    global _language, _exact, _pattern, _phrases
    _language = code if code in LANGUAGES else DEFAULT_LANGUAGE
    if _language == "en" and not _exact:
        from .translations_en import PATTERNS, TRANSLATIONS
        _exact = dict(TRANSLATIONS)
        _phrases = [(re.compile(pattern), replacement) for pattern, replacement in PATTERNS]
        # One-character pieces (units such as " 筆") only count with a space around them, so they
        # cannot hit the middle of server text.
        keys = sorted((k for k in _exact if len(k.strip()) >= 2 or k != k.strip()), key=len, reverse=True)
        _pattern = re.compile("|".join(re.escape(k) for k in keys))


def saved_language() -> str:
    """The language chosen earlier (QSettings) unless CLUBDESK_LANG says otherwise."""
    code = os.environ.get("CLUBDESK_LANG", "").strip().lower()
    if code in LANGUAGES:
        return code
    try:
        from PySide6.QtCore import QSettings
        code = str(QSettings().value("language", DEFAULT_LANGUAGE))
    except Exception:  # noqa: BLE001 - no Qt (tests of the Qt-free modules)
        code = DEFAULT_LANGUAGE
    return code if code in LANGUAGES else DEFAULT_LANGUAGE


def save_language(code: str) -> None:
    from PySide6.QtCore import QSettings
    QSettings().setValue("language", code)


def _tidy(text: str) -> str:
    text = text.translate(_PUNCTUATION)
    return re.sub(r"[ ]{2,}", " ", re.sub(r" +([,.:;?!)])", r"\1", text))


_OPEN, _CLOSE = "\ue000", "\ue001"
_MARKED = re.compile(f"{_OPEN}(.*?){_CLOSE}", re.S)


def raw(text):
    """Marks server data inside a text built for display, so tr() leaves it exactly as it is.

    Wrap the data (names, titles, article / chat bodies ...) where it is put into a label, a rich-text
    view or a Word document next to program text. In Chinese mode this does nothing.
    """
    if _language != "en" or not isinstance(text, str) or not text:
        return text
    return f"{_OPEN}{text}{_CLOSE}"


def tr(text, pieces: bool = True):
    """English text for a Chinese program text (anything else comes back unchanged)."""
    if _language == "en" and isinstance(text, str) and _OPEN in text:
        # Server data marked with raw() stays; the program text around it is translated.
        parts = _MARKED.split(text)
        return "".join(part if i % 2 else tr(part, pieces) for i, part in enumerate(parts))
    if _language != "en" or not isinstance(text, str) or not _CJK.search(text) or text.startswith("\u200b"):
        return text  # not Chinese, or marked (leading zero-width space) as text that must stay as written
    hit = _exact.get(text)
    if hit is not None:
        return hit
    stripped = text.strip()
    hit = _exact.get(stripped) if stripped != text else None
    if hit is not None:
        return text[: len(text) - len(text.lstrip())] + hit + text[len(text.rstrip()):]
    if not pieces or _pattern is None:
        return text
    result = text
    for phrase, replacement in _phrases:
        result = phrase.sub(replacement, result)
    result = _pattern.sub(lambda m: _exact[m.group(0)], result)
    return _tidy(result) if result != text else text


def tr_exact(text):
    return tr(text, pieces=False)


# ------------------------------------------------------------------ Qt hooks
_installed = False


def _hook(cls, name, translate_args, pieces=True) -> None:
    """Wraps cls.name so the positional args at `translate_args` go through tr().

    An index in `translate_args` may be negative-free only; a list of strings is translated item by item.
    """
    original = getattr(cls, name, None)
    if original is None:
        return

    def wrapper(self, *args, **kwargs):
        if _language == "en" and args:
            args = list(args)
            for i in translate_args:
                if i < len(args):
                    args[i] = _translate_arg(args[i], pieces)
            args = tuple(args)
        return original(self, *args, **kwargs)

    wrapper.__name__ = name
    wrapper.__doc__ = getattr(original, "__doc__", None)
    try:
        setattr(cls, name, wrapper)
    except (TypeError, AttributeError):
        pass


def _translate_arg(value, pieces):
    if isinstance(value, str):
        return tr(value, pieces)
    if isinstance(value, (list, tuple)) and value and all(isinstance(v, str) for v in value):
        return type(value)(tr(v, pieces) for v in value)
    return value


def _hook_text_arg(cls, name, pieces=True) -> None:
    """Like _hook, but for methods whose text may follow an optional icon / widget: the first str is translated."""
    original = getattr(cls, name, None)
    if original is None:
        return

    def wrapper(self, *args, **kwargs):
        if _language == "en":
            args = _first_string(args, pieces)
        return original(self, *args, **kwargs)

    wrapper.__name__ = name
    try:
        setattr(cls, name, wrapper)
    except (TypeError, AttributeError):
        pass


def _first_string(args, pieces, count=1):
    """Translates the first `count` string (or list of strings) arguments."""
    args = list(args)
    for i, value in enumerate(args):
        if count <= 0:
            break
        if isinstance(value, str):
            args[i] = tr(value, pieces)
            count -= 1
        elif isinstance(value, (list, tuple)) and value and all(isinstance(v, str) for v in value):
            args[i] = type(value)(tr(v, pieces) for v in value)
            count -= 1
    return tuple(args)


def _hook_init(cls, pieces=True, count=1) -> None:
    original = cls.__init__

    def init(self, *args, **kwargs):
        if _language == "en":
            args = _first_string(args, pieces, count)
        original(self, *args, **kwargs)

    try:
        cls.__init__ = init
    except (TypeError, AttributeError):
        pass


def _hook_static(cls, name, indexes, pieces=True, exact_indexes=()) -> None:
    """Static dialog helpers (QMessageBox.critical(parent, title, text, ...), QInputDialog.getText ...).

    `exact_indexes` are arguments that may hold names or paths (default file name): whole-text matches only.
    """
    original = getattr(cls, name, None)
    if original is None:
        return

    def wrapper(*args, **kwargs):
        if _language == "en":
            args = list(args)
            for i in indexes:
                if i < len(args) and isinstance(args[i], str):
                    args[i] = tr(args[i], pieces)
            for i in exact_indexes:
                if i < len(args) and isinstance(args[i], str):
                    args[i] = tr(args[i], False)
            args = tuple(args)
        return original(*args, **kwargs)

    wrapper.__name__ = name
    try:
        setattr(cls, name, staticmethod(wrapper))
    except (TypeError, AttributeError):
        pass


def install() -> None:
    """Hooks the Qt classes (once). Call it after set_language(), before any window is built."""
    global _installed
    if _installed or _language != "en":
        return
    _installed = True
    from PySide6 import QtGui, QtWidgets as W

    for cls in (W.QLabel, W.QAbstractButton):
        _hook(cls, "setText", (0,))
    for cls in (W.QLabel, W.QPushButton, W.QCheckBox, W.QRadioButton, W.QToolButton, W.QGroupBox, W.QMenu,
                QtGui.QAction):
        _hook_init(cls)
    _hook_init(W.QProgressDialog, count=2)  # label and cancel button
    _hook(W.QGroupBox, "setTitle", (0,))
    _hook(W.QMenu, "setTitle", (0,))
    for name in ("addMenu", "addAction", "addSection"):
        _hook_text_arg(W.QMenu, name)
    _hook_text_arg(W.QMenuBar, "addMenu")
    _hook_text_arg(W.QToolBar, "addAction")
    _hook(W.QMainWindow, "addToolBar", (0,))
    for name in ("setText", "setToolTip", "setStatusTip", "setIconText", "setWhatsThis"):
        _hook(QtGui.QAction, name, (0,))
    for name in ("setWindowTitle", "setToolTip", "setStatusTip", "setWhatsThis"):
        _hook(W.QWidget, name, (0,))
    for cls in (W.QLineEdit, W.QTextEdit, W.QPlainTextEdit):
        _hook(cls, "setPlaceholderText", (0,))
    # Rich-text views show program text mixed with server data (mark that with raw()); editors hold server
    # data that is saved back, so they only get whole-text matches. QTextBrowser first: it must wrap the
    # native QTextEdit.setHtml, not the hooked one.
    _hook(W.QTextBrowser, "setHtml", (0,))
    _hook(W.QTextEdit, "setHtml", (0,), pieces=False)
    _hook(W.QTextEdit, "setPlainText", (0,), pieces=False)
    _hook(W.QPlainTextEdit, "setPlainText", (0,), pieces=False)
    for cls in (W.QSpinBox, W.QDoubleSpinBox):
        _hook(cls, "setSuffix", (0,))
        _hook(cls, "setPrefix", (0,))
        _hook(cls, "setSpecialValueText", (0,))
    _hook(W.QAbstractSpinBox, "setSpecialValueText", (0,))
    _hook(W.QStatusBar, "showMessage", (0,))
    _hook(W.QProgressDialog, "setLabelText", (0,))
    _hook(W.QDialogButtonBox, "addButton", (0,))
    _hook(W.QMessageBox, "addButton", (0,))
    for name in ("setText", "setInformativeText", "setDetailedText", "setCheckBoxText"):
        _hook(W.QMessageBox, name, (0,))
    _hook(W.QFormLayout, "addRow", (0,))
    _hook(W.QFormLayout, "insertRow", (1,))
    _hook(W.QTabWidget, "setTabText", (1,))
    _hook(W.QTabWidget, "setTabToolTip", (1,))
    for name in ("addTab", "insertTab"):
        _hook_text_arg(W.QTabWidget, name)
    for name in ("setHorizontalHeaderLabels", "setVerticalHeaderLabels"):
        _hook(W.QTableWidget, name, (0,), pieces=False)
    _hook(W.QTreeWidget, "setHeaderLabels", (0,), pieces=False)
    _hook(W.QTreeWidget, "setHeaderLabel", (0,), pieces=False)
    # Cells and entries: whole-text matches only (they mostly hold the server's data).
    _hook(W.QTableWidgetItem, "setText", (0,), pieces=False)
    _hook_init(W.QTableWidgetItem, pieces=False)
    _hook(W.QTreeWidgetItem, "setText", (1,), pieces=False)
    _hook_init(W.QTreeWidgetItem, pieces=False)
    _hook(W.QListWidgetItem, "setText", (0,), pieces=False)
    _hook_init(W.QListWidgetItem, pieces=False)
    _hook(W.QListWidget, "addItem", (0,), pieces=False)
    _hook_text_arg(W.QComboBox, "addItem", pieces=False)
    _hook_text_arg(W.QComboBox, "insertItem", pieces=False)
    _hook(W.QComboBox, "addItems", (0,), pieces=False)
    _hook(W.QComboBox, "setItemText", (1,), pieces=False)
    # Standard dialogs.
    for name in ("critical", "warning", "information", "question", "about"):
        _hook_static(W.QMessageBox, name, (1, 2))
    _hook_static(W.QInputDialog, "getText", (1, 2))
    _hook_static(W.QInputDialog, "getMultiLineText", (1, 2))
    _hook_static(W.QInputDialog, "getInt", (1, 2))
    _hook_static(W.QInputDialog, "getItem", (1, 2))
    for name in ("getOpenFileName", "getSaveFileName", "getOpenFileNames"):
        _hook_static(W.QFileDialog, name, (1, 3), exact_indexes=(2,))
    _hook_static(W.QFileDialog, "getExistingDirectory", (1,))
    _hook(W.QSystemTrayIcon, "showMessage", (0, 1))
    _hook(W.QSystemTrayIcon, "setToolTip", (0,))



_translator = None


def apply_qt_locale(app) -> None:
    """Qt's own texts (Yes / No / OK ..., month names) in the interface language."""
    global _translator
    from PySide6.QtCore import QLibraryInfo, QLocale, QTranslator
    if _translator is not None:
        app.removeTranslator(_translator)
        _translator = None
    if is_english():
        QLocale.setDefault(QLocale(QLocale.English, QLocale.UnitedStates))
        return
    QLocale.setDefault(QLocale(QLocale.Chinese, QLocale.Taiwan))
    translator = QTranslator(app)
    if translator.load("qtbase_zh_TW", QLibraryInfo.path(QLibraryInfo.TranslationsPath)):
        app.installTranslator(translator)
        _translator = translator
