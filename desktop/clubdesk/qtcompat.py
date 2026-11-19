"""Let the program run on either Qt binding.

Windows 7 / 8 / 8.1 need the Qt 5.15 build (PySide2 with Python 3.8, the last
Python that runs on Windows 7); Windows 10 and newer use PySide6 (Qt 6).
The code is written against the PySide6 names, so when PySide6 is missing this
module registers PySide2 under the PySide6 names and fills in the few things
Qt 6 moved. Import it before any PySide6 import (main.py and clubdesk/__init__.py do).
"""

import importlib
import sys

BINDING = "PySide6"

try:
    import PySide6  # noqa: F401
except ImportError:
    import PySide2

    BINDING = "PySide2"
    sys.modules["PySide6"] = PySide2
    for _name in ("QtCore", "QtGui", "QtWidgets", "QtSvg"):
        sys.modules["PySide6." + _name] = importlib.import_module("PySide2." + _name)

    from PySide2 import QtCore, QtGui, QtWidgets

    # Qt 6 moved these from QtWidgets to QtGui.
    QtGui.QAction = QtWidgets.QAction
    QtGui.QShortcut = QtWidgets.QShortcut

    # QLibraryInfo.path(QLibraryInfo.TranslationsPath) is the Qt 6 spelling of location().
    if not hasattr(QtCore.QLibraryInfo, "path"):
        QtCore.QLibraryInfo.path = staticmethod(QtCore.QLibraryInfo.location)
