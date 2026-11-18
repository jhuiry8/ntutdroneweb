"""Classic desktop look: grey 3D dialogs, navy selection, small serif CJK font.

Uses Qt's built-in "Windows" style (bevelled buttons, sunken fields) with the
traditional system palette, so the program looks like a desktop application
from around 2010 on every operating system, not like a modern web page.
"""

from PySide6.QtGui import QColor, QFont, QFontDatabase, QPalette
from PySide6.QtWidgets import QApplication, QStyleFactory

FACE = "#D4D0C8"       # classic 3D face (button / dialog grey)
SHADOW = "#808080"
DARK = "#404040"
LIGHT = "#FFFFFF"
SELECTION = "#0A246A"  # classic navy highlight
TITLE_BAR = "#0A246A"
TITLE_BAR_END = "#A6CAF0"

# Around 2010 Traditional Chinese Windows used 新細明體 (PMingLiU) as the UI font;
# 微軟正黑體 was not yet the norm. Only Ming (serif) faces are used, with the
# closest Ming font on macOS and Linux for development.
FONT_CANDIDATES = ["PMingLiU", "新細明體", "MingLiU", "細明體",
                   "LiSong Pro", "Apple LiSung", "AR PL UMing TW", "AR PL New Sung"]

STYLESHEET = f"""
QToolBar {{ border: none; border-bottom: 1px solid {SHADOW}; spacing: 2px; padding: 1px; }}
QStatusBar {{ border-top: 1px solid {SHADOW}; }}
QStatusBar::item {{ border: 1px solid {SHADOW}; border-right-color: {LIGHT}; border-bottom-color: {LIGHT}; }}
QTableWidget, QTreeWidget, QListWidget, QTextBrowser {{ gridline-color: {FACE}; }}
QHeaderView::section {{ background: {FACE}; padding: 2px 4px;
    border: 1px solid {SHADOW}; border-top-color: {LIGHT}; border-left-color: {LIGHT}; }}
QLabel#CaptionBar {{ color: white; font-weight: bold; padding: 3px 6px;
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 {TITLE_BAR}, stop:1 {TITLE_BAR_END}); }}
QLabel#Banner {{ color: white; font-weight: bold; padding: 10px;
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 {TITLE_BAR}, stop:1 {TITLE_BAR_END}); }}
QLabel#Total {{ border: 1px solid {SHADOW}; border-right-color: {LIGHT}; border-bottom-color: {LIGHT};
    background: white; padding: 2px 6px; }}
"""


def pick_font() -> QFont:
    families = set(QFontDatabase.families())
    for name in FONT_CANDIDATES:
        if name in families:
            font = QFont(name)
            break
    else:
        font = QFont()
    font.setPointSize(9)  # 新細明體 9pt = the classic 12px bitmap size
    font.setStyleStrategy(QFont.PreferDefault)
    return font


def apply_classic_style(app: QApplication) -> None:
    if "Windows" in QStyleFactory.keys():
        app.setStyle(QStyleFactory.create("Windows"))
    palette = QPalette()
    face, light, shadow, dark = QColor(FACE), QColor(LIGHT), QColor(SHADOW), QColor(DARK)
    for group in (QPalette.Active, QPalette.Inactive, QPalette.Disabled):
        palette.setColor(group, QPalette.Window, face)
        palette.setColor(group, QPalette.Button, face)
        palette.setColor(group, QPalette.Base, light)
        palette.setColor(group, QPalette.AlternateBase, QColor("#F2F1EC"))
        palette.setColor(group, QPalette.Light, light)
        palette.setColor(group, QPalette.Midlight, QColor("#E0DFE3"))
        palette.setColor(group, QPalette.Mid, shadow)
        palette.setColor(group, QPalette.Dark, shadow)
        palette.setColor(group, QPalette.Shadow, dark)
        palette.setColor(group, QPalette.ToolTipBase, QColor("#FFFFE1"))
        palette.setColor(group, QPalette.ToolTipText, QColor("black"))
        palette.setColor(group, QPalette.Link, QColor("#0000FF"))
        text = shadow if group == QPalette.Disabled else QColor("black")
        for role in (QPalette.WindowText, QPalette.Text, QPalette.ButtonText):
            palette.setColor(group, role, text)
        palette.setColor(group, QPalette.Highlight, QColor(SELECTION if group != QPalette.Inactive else SHADOW))
        palette.setColor(group, QPalette.HighlightedText, light)
    app.setPalette(palette)
    app.setFont(pick_font())
    app.setStyleSheet(STYLESHEET)
