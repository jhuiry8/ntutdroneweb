"""Fluent (Windows 11) look, an alternative to the classic theme in style.py.

Enabled with the environment variable CLUBDESK_THEME=fluent. Rounded corners, Segoe UI,
a blue accent colour, light cards on a soft grey window and flat scroll bars.
"""

from PySide6.QtGui import QColor, QFont, QFontDatabase, QPalette
from PySide6.QtWidgets import QApplication, QStyleFactory

BG = "#F3F3F3"          # window (Mica-like)
CARD = "#FFFFFF"
STROKE = "#E0E0E0"
STROKE_STRONG = "#8A8A8A"
TEXT = "#1B1B1B"
TEXT_DIM = "#616161"
ACCENT = "#0067C0"
ACCENT_HOVER = "#1975C5"
ACCENT_PRESS = "#3183CA"
HOVER = "#F0F0F0"
PRESS = "#E6E6E6"
SELECT = "#E5F1FB"

LATIN = ["Segoe UI Variable", "Segoe UI", "Inter", "Noto Sans", "DejaVu Sans"]
CJK = ["Microsoft JhengHei UI", "Microsoft JhengHei", "Noto Sans CJK TC",
       "PingFang TC", "WenQuanYi Zen Hei"]

STYLESHEET = f"""
QWidget {{ background-color: {BG}; color: {TEXT}; }}
QDialog, QMainWindow {{ background-color: {BG}; }}
QLabel {{ background: transparent; }}
QToolTip {{ background: {CARD}; color: {TEXT}; border: 1px solid {STROKE}; padding: 4px 8px; }}

QPushButton {{
    background-color: {CARD}; color: {TEXT};
    border: 1px solid {STROKE}; border-bottom: 1px solid #CCCCCC;
    border-radius: 4px; padding: 5px 16px; min-height: 22px;
}}
QPushButton:hover {{ background-color: {HOVER}; }}
QPushButton:pressed {{ background-color: {PRESS}; color: {TEXT_DIM}; }}
QPushButton:default, QPushButton:checked {{
    background-color: {ACCENT}; color: white; border: 1px solid {ACCENT};
}}
QPushButton:default:hover {{ background-color: {ACCENT_HOVER}; }}
QPushButton:default:pressed {{ background-color: {ACCENT_PRESS}; }}
QPushButton:disabled {{ background-color: #F9F9F9; color: #A0A0A0; border: 1px solid #EBEBEB; }}

QLineEdit, QTextEdit, QPlainTextEdit, QSpinBox, QDoubleSpinBox, QDateEdit, QTimeEdit, QDateTimeEdit {{
    background-color: {CARD}; color: {TEXT};
    border: 1px solid {STROKE}; border-bottom: 1px solid {STROKE_STRONG};
    border-radius: 4px; padding: 4px 8px; min-height: 22px;
    selection-background-color: {ACCENT}; selection-color: white;
}}
QLineEdit:focus, QTextEdit:focus, QPlainTextEdit:focus, QSpinBox:focus, QDateEdit:focus,
QTimeEdit:focus, QDateTimeEdit:focus, QComboBox:focus {{
    border: 1px solid {STROKE}; border-bottom: 2px solid {ACCENT};
}}
QLineEdit:disabled, QTextEdit:disabled {{ background-color: #F9F9F9; color: #A0A0A0; }}

QComboBox {{
    background-color: {CARD}; color: {TEXT};
    border: 1px solid {STROKE}; border-bottom: 1px solid #CCCCCC;
    border-radius: 4px; padding: 4px 8px; min-height: 22px;
}}
QComboBox:hover {{ background-color: {HOVER}; }}
QComboBox::drop-down {{ border: none; width: 22px; }}
QComboBox QAbstractItemView {{
    background-color: {CARD}; border: 1px solid {STROKE}; border-radius: 6px; padding: 4px;
    selection-background-color: {SELECT}; selection-color: {TEXT}; outline: none;
}}

QCheckBox, QRadioButton {{ spacing: 8px; background: transparent; }}
QCheckBox::indicator {{ width: 18px; height: 18px; border: 1px solid {STROKE_STRONG};
    border-radius: 4px; background: {CARD}; }}
QCheckBox::indicator:checked {{ background: {ACCENT}; border: 1px solid {ACCENT}; }}
QRadioButton::indicator {{ width: 18px; height: 18px; border: 1px solid {STROKE_STRONG};
    border-radius: 10px; background: {CARD}; }}
QRadioButton::indicator:checked {{ background: {ACCENT}; border: 5px solid {CARD};
    outline: 1px solid {ACCENT}; }}

QGroupBox {{
    background-color: {CARD}; border: 1px solid {STROKE}; border-radius: 8px;
    margin-top: 14px; padding: 14px 10px 10px 10px;
}}
QGroupBox::title {{ subcontrol-origin: margin; left: 12px; padding: 0 6px;
    background-color: {BG}; color: {TEXT}; font-weight: 600; }}

QTabWidget::pane {{ border: 1px solid {STROKE}; border-radius: 8px; background: {CARD}; top: -1px; }}
QTabBar::tab {{
    background: transparent; color: {TEXT_DIM}; padding: 7px 16px; margin: 2px 2px 0 0;
    border-top-left-radius: 6px; border-top-right-radius: 6px; border: 1px solid transparent;
}}
QTabBar::tab:hover {{ background: {HOVER}; }}
QTabBar::tab:selected {{ background: {CARD}; color: {TEXT}; font-weight: 600;
    border: 1px solid {STROKE}; border-bottom: 2px solid {ACCENT}; }}

QTableWidget, QTableView, QTreeWidget, QListWidget, QTextBrowser {{
    background-color: {CARD}; alternate-background-color: #FAFAFA; color: {TEXT};
    border: 1px solid {STROKE}; border-radius: 8px; gridline-color: #EDEDED; outline: none;
    selection-background-color: {SELECT}; selection-color: {TEXT};
}}
QTableWidget::item, QTableView::item {{ padding: 5px 8px; border: none; }}
QTableWidget::item:selected, QTableView::item:selected {{ background: {SELECT}; color: {TEXT}; }}
QTableWidget::item:hover {{ background: #F5F5F5; }}
QHeaderView {{ background: {CARD}; }}
QHeaderView::section {{
    background-color: {CARD}; color: {TEXT_DIM}; font-weight: 600; padding: 7px 8px;
    border: none; border-bottom: 1px solid {STROKE}; border-right: 1px solid #F0F0F0;
}}
QTableCornerButton::section {{ background: {CARD}; border: none; }}

QListWidget::item {{ padding: 6px 8px; border-radius: 4px; margin: 1px 4px; }}
QListWidget::item:hover {{ background: {HOVER}; }}
QListWidget::item:selected {{ background: {SELECT}; color: {TEXT}; }}

QTreeWidget {{ background-color: {BG}; border: none; border-radius: 0; padding: 6px 4px;
    qproperty-indentation: 0; }}
QTreeWidget::item:has-children {{ color: {TEXT_DIM}; font-weight: 600; padding-top: 9px; }}
QTreeWidget::item:!has-children {{ padding-left: 14px; }}
QTreeWidget::item {{ padding: 7px 6px; border-radius: 6px; margin: 1px 4px; }}
QTreeWidget::item:hover {{ background: {PRESS}; }}
QTreeWidget::item:selected {{ background: {CARD}; color: {TEXT}; font-weight: 600; }}
QTreeWidget::item:!has-children:selected {{ border-left: 3px solid {ACCENT}; background: {CARD}; }}
QTreeWidget::branch {{ background: transparent; image: none; border-image: none; width: 0; }}

QMenuBar {{ background: {BG}; padding: 2px 4px; }}
QMenuBar::item {{ background: transparent; padding: 5px 10px; border-radius: 4px; }}
QMenuBar::item:selected {{ background: {PRESS}; }}
QMenu {{ background-color: {CARD}; border: 1px solid {STROKE}; border-radius: 8px; padding: 4px; }}
QMenu::item {{ padding: 6px 28px 6px 14px; border-radius: 4px; margin: 1px 2px; }}
QMenu::item:selected {{ background: {HOVER}; color: {TEXT}; }}
QMenu::item:disabled {{ color: #A0A0A0; }}
QMenu::separator {{ height: 1px; background: {STROKE}; margin: 4px 8px; }}

QToolBar {{ background: {BG}; border: none; border-bottom: 1px solid {STROKE}; spacing: 4px; padding: 4px 6px; }}
QToolBar::separator {{ width: 1px; background: {STROKE}; margin: 4px 6px; }}
QToolBar QToolButton, QToolButton {{
    background: transparent; border: 1px solid transparent; border-radius: 4px; padding: 5px 9px;
}}
QToolBar QToolButton:hover, QToolButton:hover {{ background: {HOVER}; border: 1px solid {STROKE}; }}
QToolBar QToolButton:pressed, QToolButton:pressed {{ background: {PRESS}; }}

QSplitter::handle {{ background: transparent; }}
QSplitter::handle:horizontal {{ width: 1px; background: {STROKE}; }}
QSplitter::handle:vertical {{ height: 1px; background: {STROKE}; }}

QScrollBar:vertical {{ background: transparent; width: 12px; margin: 2px; }}
QScrollBar::handle:vertical {{ background: #BDBDBD; border-radius: 3px; min-height: 30px; margin: 0 3px; }}
QScrollBar::handle:vertical:hover {{ background: #8A8A8A; margin: 0 2px; }}
QScrollBar:horizontal {{ background: transparent; height: 12px; margin: 2px; }}
QScrollBar::handle:horizontal {{ background: #BDBDBD; border-radius: 3px; min-width: 30px; margin: 3px 0; }}
QScrollBar::handle:horizontal:hover {{ background: #8A8A8A; margin: 2px 0; }}
QScrollBar::add-line, QScrollBar::sub-line {{ width: 0; height: 0; background: none; border: none; }}
QScrollBar::add-page, QScrollBar::sub-page {{ background: transparent; }}

QProgressBar {{ background: #E0E0E0; border: none; border-radius: 3px; height: 6px; text-align: center; }}
QProgressBar::chunk {{ background: {ACCENT}; border-radius: 3px; }}

QStatusBar {{ background: {BG}; border-top: 1px solid {STROKE}; color: {TEXT_DIM}; }}
QStatusBar::item {{ border: none; padding: 1px 6px; }}

/* Page header: a plain title row instead of the old navy gradient caption */
QLabel#CaptionBar, QWidget#CaptionBar {{
    background: {BG}; color: {TEXT}; padding: 6px 4px 2px 4px; border-bottom: none;
}}
QLabel#CaptionText {{ color: {TEXT}; font-size: 16pt; font-weight: 600; background: transparent; }}
QWidget#CaptionBar QLabel {{ background: transparent; color: {TEXT}; }}
QLabel#BannerLogo {{ background: {ACCENT}; padding: 8px 6px 8px 12px; }}
QLabel#Banner {{ color: white; font-size: 12pt; font-weight: 600; padding: 12px; background: {ACCENT}; }}
QLabel#Total {{
    background: {CARD}; border: 1px solid {STROKE}; border-radius: 4px; padding: 3px 10px; font-weight: 600;
}}
"""


def pick_font() -> QFont:
    from . import i18n
    families = set(QFontDatabase.families())
    names = [n for n in LATIN if n in families]
    cjk = [n for n in CJK if n in families]
    font = QFont(names[0] if names else "Segoe UI")
    if cjk:
        font.setFamilies(([names[0]] if names else []) + cjk)
    font.setPointSize(10)
    font.setStyleStrategy(QFont.PreferAntialias)
    return font


def apply_fluent_style(app: QApplication) -> None:
    keys = {k.lower(): k for k in QStyleFactory.keys()}
    for name in ("windows11", "fusion"):
        if name in keys:
            app.setStyle(QStyleFactory.create(keys[name]))
            break
    palette = QPalette()
    for group in (QPalette.Active, QPalette.Inactive, QPalette.Disabled):
        palette.setColor(group, QPalette.Window, QColor(BG))
        palette.setColor(group, QPalette.Button, QColor(CARD))
        palette.setColor(group, QPalette.Base, QColor(CARD))
        palette.setColor(group, QPalette.AlternateBase, QColor("#FAFAFA"))
        palette.setColor(group, QPalette.ToolTipBase, QColor(CARD))
        palette.setColor(group, QPalette.ToolTipText, QColor(TEXT))
        palette.setColor(group, QPalette.Link, QColor(ACCENT))
        dim = group == QPalette.Disabled
        for role in (QPalette.WindowText, QPalette.Text, QPalette.ButtonText):
            palette.setColor(group, role, QColor("#A0A0A0" if dim else TEXT))
        palette.setColor(group, QPalette.Highlight, QColor(ACCENT))
        palette.setColor(group, QPalette.HighlightedText, QColor("white"))
    app.setPalette(palette)
    app.setFont(pick_font())
    app.setStyleSheet(STYLESHEET)
