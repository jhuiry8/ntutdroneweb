"""Start-up paths that differ between PySide6 (Qt 6) and PySide2 (Qt 5.15, the Windows 7 edition)."""

import os
import sys
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    from clubdesk import qtcompat
    from PySide6.QtCore import QTimer
    from PySide6.QtGui import QFontDatabase
    from PySide6.QtWidgets import QApplication, QDialog, QMessageBox
except ImportError as error:  # no Qt binding or its system libraries
    qtcompat = None
    SKIP = str(error)
else:
    SKIP = ""


@unittest.skipIf(qtcompat is None, f"Qt unavailable: {SKIP}")
class QtStartupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication(["test"])

    def test_font_database_families_is_static(self):
        self.assertIsInstance(QFontDatabase.families(), list)

    def test_classic_style_and_font(self):
        from clubdesk.style import apply_classic_style
        apply_classic_style(self.app)
        self.assertTrue(self.app.font().family())

    def test_modal_dialog_exec(self):
        dialog = QDialog()
        QTimer.singleShot(0, dialog.accept)
        self.assertEqual(dialog.exec(), QDialog.Accepted)

    def test_error_message_box_exec(self):
        """The same call the program makes for every error: a modal box with text and a button."""
        from clubdesk.api import ApiError
        from clubdesk.widgets import show_error

        def close_it():
            box = QApplication.activeModalWidget()
            if box is None:  # not shown yet: look again
                QTimer.singleShot(50, close_it)
            else:
                box.accept()

        QTimer.singleShot(50, close_it)
        show_error(None, ApiError("測試錯誤"))

    def test_update_check_is_off_in_the_win7_edition(self):
        from clubdesk import WIN7_EDITION, updater
        self.assertEqual(WIN7_EDITION, qtcompat.BINDING == "PySide2")
        if WIN7_EDITION:
            self.assertFalse(updater.check_and_offer(None, None))


if __name__ == "__main__":
    unittest.main()
