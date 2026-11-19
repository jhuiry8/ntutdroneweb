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
from PySide6.QtGui import QColor, QIcon, QImage, QPainter, QPixmap
from PySide6.QtSvg import QSvgRenderer

from .icondata import ICONS

SIZES = (16, 20, 24, 32, 48)


def resource_path(name: str) -> Path:
    """A file in clubdesk/resources, both from source and inside the PyInstaller build."""
    if hasattr(sys, "_MEIPASS"):  # ClubDesk.spec copies clubdesk/resources next to the program
        return Path(sys._MEIPASS) / "clubdesk" / "resources" / name
    return Path(__file__).parent / "resources" / name


def svg_markup(name: str, colour: str | None = None, stroke_width: float = 2.0) -> str:
    entry = ICONS[name]
    default_colour, body = entry if isinstance(entry, (tuple, list)) else ("#000000", entry)
    if body.startswith("<svg"):
        return body
    if "<rect" in body or "<polygon" in body or "<circle" in body or "<ellipse" in body or "<text" in body or "fill=" in body:
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">{body}</svg>'
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


def _make_disabled(pixmap: QPixmap) -> QPixmap:
    img = pixmap.toImage().convertToFormat(QImage.Format_ARGB32)
    for y in range(img.height()):
        for x in range(img.width()):
            c = img.pixelColor(x, y)
            if c.alpha() > 0:
                gray = int(0.299 * c.red() + 0.587 * c.green() + 0.114 * c.blue())
                img.setPixelColor(x, y, QColor(gray, gray, gray, int(c.alpha() * 0.45)))
    return QPixmap.fromImage(img)


@lru_cache(maxsize=None)
def icon(name: str, light: bool = False) -> QIcon:
    """Named icon (cached at standard sizes with normal and disabled states); empty for unknown names."""
    if name not in ICONS:
        return QIcon()
    result = QIcon()
    for size in SIZES:
        pm = _render(svg_markup(name), size)
        result.addPixmap(pm, QIcon.Normal)
        result.addPixmap(_make_disabled(pm), QIcon.Disabled)
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
