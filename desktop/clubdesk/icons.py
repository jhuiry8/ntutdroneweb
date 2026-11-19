"""Coloured toolbar, menu and navigation icons, plus the program icon.

The shapes come from icondata.py (generated from the Lucide set the website
already uses). Each icon is drawn at 16, 20, 24 and 32 px so it stays sharp on
high-DPI screens; results are cached.
"""

from __future__ import annotations

import sys
from functools import lru_cache
from pathlib import Path

from PySide6.QtCore import QByteArray, QSize, Qt
from PySide6.QtGui import QIcon, QImage, QPainter, QPixmap
from PySide6.QtSvg import QSvgRenderer

from .icondata import ICONS

SIZES = (16, 20, 24, 32, 48)


def resource_path(name: str) -> Path:
    """A file in clubdesk/resources, both from source and inside the PyInstaller build."""
    if hasattr(sys, "_MEIPASS"):  # ClubDesk.spec copies clubdesk/resources next to the program
        return Path(sys._MEIPASS) / "clubdesk" / "resources" / name
    return Path(__file__).parent / "resources" / name


def svg_markup(name: str, colour: str | None = None, stroke_width: float = 2.0) -> str:
    default_colour, body = ICONS[name]
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" '
            f'stroke="{colour or default_colour}" stroke-width="{stroke_width}" '
            f'stroke-linecap="round" stroke-linejoin="round">{body}</svg>')


def _render(markup: str, size: int) -> QPixmap:
    renderer = QSvgRenderer(QByteArray(markup.encode("utf-8")))
    image = QImage(size, size, QImage.Format_ARGB32_Premultiplied)
    image.fill(Qt.transparent)
    painter = QPainter(image)
    painter.setRenderHint(QPainter.Antialiasing)
    renderer.render(painter)
    painter.end()
    return QPixmap.fromImage(image)


@lru_cache(maxsize=None)
def icon(name: str, light: bool = False) -> QIcon:
    """Named icon (white when light=True, for dark caption bars); empty for unknown names."""
    if name not in ICONS:
        return QIcon()
    result = QIcon()
    for size in SIZES:
        # Thicker strokes at small sizes keep 16 px icons from looking washed out.
        width = 2.4 if size <= 16 else 2.2 if size <= 20 else 2.0
        result.addPixmap(_render(svg_markup(name, "#FFFFFF" if light else None, width), size), QIcon.Normal)
        result.addPixmap(_render(svg_markup(name, "#A0A0A0", width), size), QIcon.Disabled)
    return result


@lru_cache(maxsize=None)
def app_icon() -> QIcon:
    result = QIcon()
    ico = resource_path("app.ico")
    png = resource_path("app.png")
    if ico.exists():
        result = QIcon(str(ico))
    if png.exists():
        result.addFile(str(png), QSize(256, 256))
    return result


def app_pixmap(size: int = 48) -> QPixmap:
    return app_icon().pixmap(size, size)
