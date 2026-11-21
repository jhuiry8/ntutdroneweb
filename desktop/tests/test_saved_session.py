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
        # Pretend to be Windows with a reversible stand-in for DPAPI, so the tests run everywhere.
        self.originals = (saved_session.supported, saved_session._dpapi)
        saved_session.supported = lambda: True
        saved_session._dpapi = lambda data, decrypt: data[::-1]

    def tearDown(self):
        saved_session.supported, saved_session._dpapi = self.originals
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

    def test_token_is_stored_protected(self):
        saved_session.save("https://club.example", "admin", "tok-123")
        stored = QSettings().value("session/token", "", str)
        self.assertTrue(stored)
        self.assertNotIn("tok-123", stored)
        self.assertNotIn("tok-123", __import__("base64").b64decode(stored).decode("latin-1"))

    def test_nothing_is_saved_without_encryption(self):
        saved_session.supported = lambda: False
        saved_session.save("https://club.example", "admin", "tok-123")
        self.assertEqual(QSettings().value("session/token", "", str), "")
        self.assertIsNone(saved_session.load())

    def test_old_unencrypted_token_is_removed_without_encryption(self):
        QSettings().setValue("session/server", "https://club.example")
        QSettings().setValue("session/token", "dG9rLTEyMw==")  # base64 left by an older version
        QSettings().setValue("session/expires", 2 ** 31)
        saved_session.supported = lambda: False
        self.assertIsNone(saved_session.load())
        self.assertEqual(QSettings().value("session/token", "", str), "")


if __name__ == "__main__":
    unittest.main()
