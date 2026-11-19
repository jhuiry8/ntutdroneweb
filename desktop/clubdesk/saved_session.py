"""Keeps the 30-day "stay signed in" session between runs of the program.

The website hands out a session token valid for 30 days when asked to remember
the login. It is stored in QSettings, encrypted with Windows DPAPI (only this
Windows user on this computer can decrypt it). The password is never stored.
After 30 days, or after a password change or sign-out, the person signs in again.
"""

from __future__ import annotations

import base64
import sys
import time

from PySide6.QtCore import QSettings

REMEMBER_DAYS = 30
KEY = "session"


def _dpapi(data: bytes, decrypt: bool) -> bytes:
    import ctypes
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.c_void_p)]

    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    function = crypt32.CryptUnprotectData if decrypt else crypt32.CryptProtectData
    function.restype = wintypes.BOOL
    if decrypt:  # data, description out, entropy, reserved, prompt, flags, out
        function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
                             ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    else:  # data, description, entropy, reserved, prompt, flags, out
        function.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.c_void_p, ctypes.c_void_p,
                             ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    buffer = ctypes.create_string_buffer(data, len(data))
    source = Blob(len(data), ctypes.cast(buffer, ctypes.c_void_p))
    target = Blob()
    if not function(ctypes.byref(source), None if decrypt else "ClubDesk", None, None, None, 0, ctypes.byref(target)):
        raise OSError(ctypes.get_last_error(), "DPAPI failed")
    try:
        return ctypes.string_at(target.pbData, target.cbData)
    finally:
        kernel32.LocalFree(target.pbData)


def protect(text: str) -> str:
    raw = text.encode("utf-8")
    return base64.b64encode(_dpapi(raw, False) if sys.platform == "win32" else raw).decode("ascii")


def unprotect(text: str) -> str:
    raw = base64.b64decode(text.encode("ascii"))
    return (_dpapi(raw, True) if sys.platform == "win32" else raw).decode("utf-8")


def save(server: str, username: str, token: str, seconds: int | None = None, now: float | None = None) -> None:
    seconds = seconds or REMEMBER_DAYS * 86400
    expires = int((time.time() if now is None else now) + seconds)
    settings = QSettings()
    settings.setValue(f"{KEY}/server", server)
    settings.setValue(f"{KEY}/username", username)
    settings.setValue(f"{KEY}/expires", expires)
    settings.setValue(f"{KEY}/token", protect(token))


def load(now: float | None = None) -> dict | None:
    """The saved session, or None when there is none, it has expired or cannot be decrypted."""
    settings = QSettings()
    server = settings.value(f"{KEY}/server", "", str)
    encrypted = settings.value(f"{KEY}/token", "", str)
    try:
        expires = int(settings.value(f"{KEY}/expires", 0))
        if not server or not encrypted:
            return None
        if expires <= (time.time() if now is None else now):
            clear()
            return None
        return {"server": server, "username": settings.value(f"{KEY}/username", "", str),
                "token": unprotect(encrypted), "expires": expires}
    except (TypeError, ValueError, OSError):
        clear()
        return None


def clear() -> None:
    settings = QSettings()
    settings.remove(KEY)


def days_left(expires: int, now: float | None = None) -> int:
    return max(0, int((expires - (time.time() if now is None else now)) // 86400))
