"""Start the program when the person signs in to Windows (current user, no administrator needed).

Adds or removes a value under HKEY_CURRENT_USER\\...\\Run. The program is started
with --autostart, which keeps the window hidden in the system tray.
"""

from __future__ import annotations

import sys

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
VALUE_NAME = "ClubDesk"
AUTOSTART_FLAG = "--autostart"


def supported() -> bool:
    return sys.platform == "win32"


def command() -> str:
    if getattr(sys, "frozen", False):  # the installed ClubDesk.exe
        return f'"{sys.executable}" {AUTOSTART_FLAG}'
    import os
    script = os.path.abspath(sys.argv[0])
    return f'"{sys.executable}" "{script}" {AUTOSTART_FLAG}'


def is_enabled() -> bool:
    if not supported():
        return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            winreg.QueryValueEx(key, VALUE_NAME)
        return True
    except OSError:
        return False


def set_enabled(enabled: bool) -> None:
    if not supported():
        return
    import winreg
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, VALUE_NAME, 0, winreg.REG_SZ, command())
        else:
            try:
                winreg.DeleteValue(key, VALUE_NAME)
            except FileNotFoundError:
                pass
