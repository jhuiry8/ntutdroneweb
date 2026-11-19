"""Notification sound that does not depend on the operating system's sound scheme.

QApplication.beep() is silent on many Windows 10/11 machines (the "Default Beep"
event is often muted), so the program carries its own two-note chime, writes it
once to a temporary WAV file and plays it with winsound. Other platforms fall back
to the Qt beep.
"""

from __future__ import annotations

import math
import os
import struct
import sys
import tempfile
import wave

SAMPLE_RATE = 22050
NOTES = ((880.0, 0.14), (1318.5, 0.26))  # A5 then E6: a short rising "ding-dong"
_path: str | None = None


def chime_samples() -> bytes:
    """16-bit mono PCM for the chime, each note with a quick attack and a smooth decay."""
    frames = bytearray()
    for frequency, seconds in NOTES:
        count = int(SAMPLE_RATE * seconds)
        for i in range(count):
            envelope = min(1.0, i / (SAMPLE_RATE * 0.008)) * math.exp(-4.0 * i / count)
            frames += struct.pack("<h", int(14000 * envelope * math.sin(2 * math.pi * frequency * i / SAMPLE_RATE)))
    return bytes(frames)


def chime_file() -> str:
    """Path of the chime WAV (created on first use, reused afterwards)."""
    global _path
    if _path and os.path.exists(_path):
        return _path
    path = os.path.join(tempfile.gettempdir(), "clubdesk-notify.wav")
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        out.writeframes(chime_samples())
    _path = path
    return path


def play_notification_sound() -> None:
    """Play the chime without blocking; never raises."""
    try:
        if sys.platform == "win32":
            import winsound
            winsound.PlaySound(chime_file(), winsound.SND_FILENAME | winsound.SND_ASYNC | winsound.SND_NODEFAULT)
            return
    except Exception:  # noqa: BLE001 - sound is optional
        pass
    try:
        from PySide6.QtWidgets import QApplication
        QApplication.beep()
    except Exception:  # noqa: BLE001
        pass
