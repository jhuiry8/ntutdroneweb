"""北科無人機社 社務管理系統 — desktop client for the club website's back end."""

__version__ = "1.2.0"

from . import qtcompat  # noqa: E402  (PySide2 fallback for the Windows 7 edition)

# The Windows 7 edition is a separate, frozen build (Python 3.8 + Qt 5.15) without automatic updates.
WIN7_EDITION = qtcompat.BINDING == "PySide2"
