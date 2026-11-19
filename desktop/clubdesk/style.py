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

LATIN_CANDIDATES = ["Tahoma", "MS Sans Serif", "Segoe UI", "Arial", "Liberation Sans", "DejaVu Sans"]

STYLESHEET = f"""
/* Windows 98 / 2000 Authentic 3D Bevels & System Colors */
QWidget {{
    background-color: {FACE};
    color: black;
}}

/* Classic 3D Buttons */
QPushButton {{
    background-color: {FACE};
    color: black;
    border-top: 2px solid {LIGHT};
    border-left: 2px solid {LIGHT};
    border-right: 2px solid {DARK};
    border-bottom: 2px solid {DARK};
    padding: 3px 12px;
    min-height: 20px;
}}
QPushButton:hover {{
    background-color: {FACE};
}}
QPushButton:pressed {{
    border-top: 2px solid {DARK};
    border-left: 2px solid {DARK};
    border-right: 2px solid {LIGHT};
    border-bottom: 2px solid {LIGHT};
    padding-top: 4px;
    padding-left: 13px;
}}
QPushButton:disabled {{
    color: {SHADOW};
    border-top: 1px solid {SHADOW};
    border-left: 1px solid {SHADOW};
    border-right: 1px solid {LIGHT};
    border-bottom: 1px solid {LIGHT};
}}

/* Classic Sunken Input Fields (Sunken 3D) */
QLineEdit, QTextEdit, QPlainTextEdit, QSpinBox, QDateEdit, QTimeEdit {{
    background-color: {LIGHT};
    color: black;
    border-top: 2px solid {SHADOW};
    border-left: 2px solid {SHADOW};
    border-right: 2px solid {LIGHT};
    border-bottom: 2px solid {LIGHT};
    padding: 2px;
    selection-background-color: {SELECTION};
    selection-color: {LIGHT};
}}
QLineEdit:focus, QTextEdit:focus, QPlainTextEdit:focus {{
    border-top: 2px solid black;
    border-left: 2px solid black;
    border-right: 2px solid {LIGHT};
    border-bottom: 2px solid {LIGHT};
}}

/* Classic ComboBox */
QComboBox {{
    background-color: {LIGHT};
    color: black;
    border-top: 2px solid {SHADOW};
    border-left: 2px solid {SHADOW};
    border-right: 2px solid {LIGHT};
    border-bottom: 2px solid {LIGHT};
    padding: 2px 4px;
    min-height: 20px;
}}
QComboBox::drop-down {{
    subcontrol-origin: padding;
    subcontrol-position: top right;
    width: 18px;
    background-color: {FACE};
    border-top: 2px solid {LIGHT};
    border-left: 2px solid {LIGHT};
    border-right: 2px solid {DARK};
    border-bottom: 2px solid {DARK};
}}
QComboBox::drop-down:pressed {{
    border-top: 2px solid {DARK};
    border-left: 2px solid {DARK};
    border-right: 2px solid {LIGHT};
    border-bottom: 2px solid {LIGHT};
}}
QComboBox QAbstractItemView {{
    background-color: {LIGHT};
    color: black;
    selection-background-color: {SELECTION};
    selection-color: {LIGHT};
    border: 1px solid {SHADOW};
}}

/* Classic GroupBox */
QGroupBox {{
    background-color: {FACE};
    border: 2px groove {LIGHT};
    margin-top: 8px;
    padding-top: 8px;
    font-weight: bold;
}}
QGroupBox::title {{
    subcontrol-origin: margin;
    subcontrol-position: top left;
    padding: 0 4px;
    background-color: {FACE};
}}

/* Classic TabWidget */
QTabWidget::pane {{
    border-top: 2px solid {LIGHT};
    border-left: 2px solid {LIGHT};
    border-right: 2px solid {DARK};
    border-bottom: 2px solid {DARK};
    background-color: {FACE};
}}
QTabBar::tab {{
    background-color: {FACE};
    border-top: 2px solid {LIGHT};
    border-left: 2px solid {LIGHT};
    border-right: 2px solid {DARK};
    border-bottom: none;
    padding: 4px 10px;
    margin-right: 2px;
}}
QTabBar::tab:selected {{
    margin-bottom: -1px;
    padding-bottom: 5px;
    font-weight: bold;
}}

/* Classic Tables, Trees and Lists */
QTableWidget, QTreeWidget, QListWidget, QTextBrowser {{
    background-color: {LIGHT};
    color: black;
    border-top: 2px solid {SHADOW};
    border-left: 2px solid {SHADOW};
    border-right: 2px solid {LIGHT};
    border-bottom: 2px solid {LIGHT};
    gridline-color: {FACE};
    selection-background-color: {SELECTION};
    selection-color: {LIGHT};
}}
QHeaderView::section {{
    background-color: {FACE};
    color: black;
    font-weight: bold;
    padding: 2px 4px;
    border-top: 2px solid {LIGHT};
    border-left: 2px solid {LIGHT};
    border-right: 2px solid {SHADOW};
    border-bottom: 2px solid {SHADOW};
}}
QHeaderView::section:pressed {{
    border-top: 2px solid {SHADOW};
    border-left: 2px solid {SHADOW};
    border-right: 2px solid {LIGHT};
    border-bottom: 2px solid {LIGHT};
}}

/* Classic Menu Bar and Menus */
QMenuBar {{
    background-color: {FACE};
    border-bottom: 1px solid {SHADOW};
}}
QMenuBar::item {{
    background: transparent;
    padding: 3px 6px;
}}
QMenuBar::item:selected {{
    background-color: {SELECTION};
    color: {LIGHT};
}}
QMenu {{
    background-color: {FACE};
    border-top: 2px solid {LIGHT};
    border-left: 2px solid {LIGHT};
    border-right: 2px solid {DARK};
    border-bottom: 2px solid {DARK};
    padding: 2px;
}}
QMenu::item {{
    padding: 3px 20px 3px 18px;
}}
QMenu::item:selected {{
    background-color: {SELECTION};
    color: {LIGHT};
}}
QMenu::separator {{
    height: 2px;
    background: {SHADOW};
    border-bottom: 1px solid {LIGHT};
    margin: 3px 2px;
}}

/* Classic Toolbar */
QToolBar {{
    background-color: {FACE};
    border: none;
    border-bottom: 1px solid {SHADOW};
    spacing: 2px;
    padding: 2px;
}}
QToolBar::separator {{
    width: 2px;
    background: {SHADOW};
    border-right: 1px solid {LIGHT};
    margin: 2px 4px;
}}
QToolBar QToolButton {{
    background: transparent;
    border: 1px solid transparent;
    padding: 3px 6px;
}}
QToolBar QToolButton:hover {{
    border-top: 1px solid {LIGHT};
    border-left: 1px solid {LIGHT};
    border-right: 1px solid {SHADOW};
    border-bottom: 1px solid {SHADOW};
}}
QToolBar QToolButton:pressed {{
    border-top: 1px solid {SHADOW};
    border-left: 1px solid {SHADOW};
    border-right: 1px solid {LIGHT};
    border-bottom: 1px solid {LIGHT};
}}

/* Classic Splitter */
QSplitter::handle:horizontal {{
    width: 4px;
    background-color: {FACE};
    border-left: 1px solid {LIGHT};
    border-right: 1px solid {SHADOW};
}}
QSplitter::handle:vertical {{
    height: 4px;
    background-color: {FACE};
    border-top: 1px solid {LIGHT};
    border-bottom: 1px solid {SHADOW};
}}

/* Classic ScrollBar */
QScrollBar:vertical {{
    width: 16px;
    background-color: {FACE};
    margin: 16px 0 16px 0;
    border: 1px solid {SHADOW};
}}
QScrollBar::handle:vertical {{
    background-color: {FACE};
    min-height: 20px;
    border-top: 2px solid {LIGHT};
    border-left: 2px solid {LIGHT};
    border-right: 2px solid {DARK};
    border-bottom: 2px solid {DARK};
}}
QScrollBar::add-line:vertical {{
    height: 16px;
    subcontrol-position: bottom;
    subcontrol-origin: margin;
    background-color: {FACE};
    border-top: 2px solid {LIGHT};
    border-left: 2px solid {LIGHT};
    border-right: 2px solid {DARK};
    border-bottom: 2px solid {DARK};
}}
QScrollBar::sub-line:vertical {{
    height: 16px;
    subcontrol-position: top;
    subcontrol-origin: margin;
    background-color: {FACE};
    border-top: 2px solid {LIGHT};
    border-left: 2px solid {LIGHT};
    border-right: 2px solid {DARK};
    border-bottom: 2px solid {DARK};
}}
QScrollBar:horizontal {{
    height: 16px;
    background-color: {FACE};
    margin: 0 16px 0 16px;
    border: 1px solid {SHADOW};
}}
QScrollBar::handle:horizontal {{
    background-color: {FACE};
    min-width: 20px;
    border-top: 2px solid {LIGHT};
    border-left: 2px solid {LIGHT};
    border-right: 2px solid {DARK};
    border-bottom: 2px solid {DARK};
}}
QScrollBar::add-line:horizontal {{
    width: 16px;
    subcontrol-position: right;
    subcontrol-origin: margin;
    background-color: {FACE};
    border-top: 2px solid {LIGHT};
    border-left: 2px solid {LIGHT};
    border-right: 2px solid {DARK};
    border-bottom: 2px solid {DARK};
}}
QScrollBar::sub-line:horizontal {{
    width: 16px;
    subcontrol-position: left;
    subcontrol-origin: margin;
    background-color: {FACE};
    border-top: 2px solid {LIGHT};
    border-left: 2px solid {LIGHT};
    border-right: 2px solid {DARK};
    border-bottom: 2px solid {DARK};
}}

/* Classic Status Bar with sunken panels */
QStatusBar {{
    background-color: {FACE};
    border-top: 1px solid {SHADOW};
}}
QStatusBar::item {{
    border-top: 1px solid {SHADOW};
    border-left: 1px solid {SHADOW};
    border-right: 1px solid {LIGHT};
    border-bottom: 1px solid {LIGHT};
    padding: 1px 4px;
}}

/* Windows 2000 MMC Gradient Caption Bar */
QLabel#CaptionBar, QWidget#CaptionBar {{
    color: white;
    font-weight: bold;
    padding: 3px 6px;
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 {TITLE_BAR}, stop:1 {TITLE_BAR_END});
}}
QLabel#CaptionText {{
    color: white;
    font-weight: bold;
    background: transparent;
}}
QWidget#CaptionBar QLabel {{
    background: transparent;
}}
QLabel#BannerLogo {{
    background: {TITLE_BAR};
    padding: 6px 4px 6px 10px;
}}
QLabel#Banner {{
    color: white;
    font-weight: bold;
    padding: 10px;
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 {TITLE_BAR}, stop:1 {TITLE_BAR_END});
}}
QLabel#Total {{
    border-top: 1px solid {SHADOW};
    border-left: 1px solid {SHADOW};
    border-right: 1px solid {LIGHT};
    border-bottom: 1px solid {LIGHT};
    background: white;
    padding: 2px 6px;
}}
"""


def pick_font() -> QFont:
    import os, sys
    if sys.platform == "win32":
        for path in ("C:/Windows/Fonts/mingliu.ttc", "C:/Windows/Fonts/mingliu.ttf",
                     "C:/Windows/Fonts/msjh.ttc", "C:/Windows/Fonts/simsun.ttc"):
            if os.path.exists(path):
                QFontDatabase.addApplicationFont(path)
                break
    families = set(QFontDatabase.families())
    from . import i18n
    if i18n.is_english():
        # English text reads better in a Latin face; Chinese data still falls back to the Ming font.
        for name in LATIN_CANDIDATES:
            if name in families:
                font = QFont(name)
                font.setPointSize(9)
                font.setStyleStrategy(QFont.PreferDefault)
                return font
    for name in FONT_CANDIDATES:
        if name in families:
            font = QFont(name)
            break
    else:
        font = QFont("PMingLiU")
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
