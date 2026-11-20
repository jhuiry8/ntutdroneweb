"""Tests for the 30-day saved session (QSettings in a temporary folder, no window needed)."""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from PySide6.QtCore import QCoreApplication, QSettings  # noqa: E402

from clubdesk import saved_session  # noqa: E402

DAY = 86400


class SavedSessionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        QSettings.setDefaultFormat(QSettings.IniFormat)
        QSettings.setPath(QSettings.IniFormat, QSettings.UserScope, cls.folder.name)
        QCoreApplication.setOrganizationName("ClubDeskTest")
        QCoreApplication.setApplicationName("saved-session")

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def setUp(self):
        saved_session.clear()

    def test_round_trip_within_30_days(self):
        saved_session.save("https://club.example", "admin", "tok-123", now=1000)
        found = saved_session.load(now=1000 + 29 * DAY)
        self.assertEqual((found["server"], found["username"], found["token"]), ("https://club.example", "admin", "tok-123"))
        self.assertEqual(saved_session.days_left(found["expires"], now=1000 + 29 * DAY), 1)

    def test_expired_session_is_dropped(self):
        saved_session.save("https://club.example", "admin", "tok-123", now=1000)
        self.assertIsNone(saved_session.load(now=1000 + 30 * DAY + 1))
        self.assertIsNone(saved_session.load(now=1000))  # cleared, not just ignored

    def test_clear_and_empty(self):
        self.assertIsNone(saved_session.load())
        saved_session.save("https://club.example", "admin", "tok-123")
        saved_session.clear()
        self.assertIsNone(saved_session.load())

    def test_token_is_not_stored_in_plain_text_on_windows_only(self):
        saved_session.save("https://club.example", "admin", "tok-123")
        stored = QSettings().value("session/token", "", str)
        self.assertTrue(stored)
        if sys.platform == "win32":
            self.assertNotIn("tok-123", stored)


if __name__ == "__main__":
    unittest.main()
