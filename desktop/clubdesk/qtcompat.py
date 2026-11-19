"""Run the program on either Qt binding.

The normal edition (Windows 10 / 11) uses PySide6 (Qt 6, Python 3.12). The separate
"Windows 7 edition" is built with Python 3.8 + PySide2 (Qt 5.15), the newest combination
that still runs on Windows 7 SP1 (see README, "Windows 7 版").

The code is written against the PySide6 names, so when PySide6 is missing this module
registers PySide2 under the PySide6 names and fills in what Qt 6 changed. Import it
before any PySide6 import (main.py and clubdesk/__init__.py do). When neither binding
is installed it does nothing, so the Qt-free modules (api, docx) still import.
"""

import importlib
import sys

BINDING = "PySide6"


def _install_pyside2() -> None:
    sys.modules["PySide6"] = importlib.import_module("PySide2")
    for name in ("QtCore", "QtGui", "QtWidgets", "QtSvg"):
        sys.modules["PySide6." + name] = importlib.import_module("PySide2." + name)

    from PySide2 import QtCore, QtGui, QtWidgets

    # Qt 6 moved these from QtWidgets to QtGui.
    QtGui.QAction = QtWidgets.QAction
    QtGui.QShortcut = QtWidgets.QShortcut

    # QLibraryInfo.path(...) is the Qt 6 spelling of location(...).
    if not hasattr(QtCore.QLibraryInfo, "path"):
        QtCore.QLibraryInfo.path = staticmethod(QtCore.QLibraryInfo.location)

    # PySide2 5.15 only has exec_(); Qt 6 / PySide6 use exec().
    for cls in (QtWidgets.QApplication, QtWidgets.QDialog, QtWidgets.QMessageBox, QtWidgets.QMenu,
                QtCore.QEventLoop, QtCore.QCoreApplication):
        if not hasattr(cls, "exec") and hasattr(cls, "exec_"):
            cls.exec = cls.exec_

    # QFontDatabase.families() is static in Qt 6 but an instance method in Qt 5.
    original_families = QtGui.QFontDatabase.families

    def families(writing_system=QtGui.QFontDatabase.Any):
        return original_families(QtGui.QFontDatabase(), writing_system)

    QtGui.QFontDatabase.families = staticmethod(families)

    # Qt 6 scales for high-DPI screens by itself; Qt 5 has to be asked, before QApplication exists.
    QtCore.QCoreApplication.setAttribute(QtCore.Qt.AA_EnableHighDpiScaling, True)
    QtCore.QCoreApplication.setAttribute(QtCore.Qt.AA_UseHighDpiPixmaps, True)


try:
    import PySide6  # noqa: F401
except ImportError:
    try:
        import PySide2  # noqa: F401
    except ImportError:
        BINDING = None  # no Qt at all: only the Qt-free modules can be imported
    else:
        BINDING = "PySide2"
        _install_pyside2()
