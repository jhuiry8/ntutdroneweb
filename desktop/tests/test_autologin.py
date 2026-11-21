"""Tests for start-up auto login: expiry, rejected token and boot-time network retries."""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from PySide6.QtCore import QCoreApplication, QSettings  # noqa: E402

from clubdesk import autologin, saved_session  # noqa: E402
from clubdesk.api import ApiError  # noqa: E402


class FakeClient:
    results: list = []

    def __init__(self, base_url):
        self.base_url, self.token, self.calls, self.timeouts = base_url, "", 0, []
        FakeClient.last = self

    def me(self, timeout=None):
        self.timeouts.append(timeout)
        self.calls += 1
        result = FakeClient.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class AutoLoginTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        QSettings.setDefaultFormat(QSettings.IniFormat)
        QSettings.setPath(QSettings.IniFormat, QSettings.UserScope, cls.folder.name)
        QCoreApplication.setOrganizationName("ClubDeskTest")
        QCoreApplication.setApplicationName("autologin")

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def setUp(self):
        saved_session.clear()
        # Pretend to be Windows with a reversible stand-in for DPAPI (the session is only stored there).
        self.originals = (saved_session.supported, saved_session._dpapi)
        saved_session.supported = lambda: True
        saved_session._dpapi = lambda data, decrypt: data[::-1]
        self.addCleanup(lambda: setattr(saved_session, "supported", self.originals[0]))
        self.addCleanup(lambda: setattr(saved_session, "_dpapi", self.originals[1]))
        saved_session.save("https://club.example", "admin", "tok")
        self.sleeps = []

    def run_login(self, results, autostarted):
        FakeClient.results = list(results)
        return autologin.auto_login(autostarted, sleep=self.sleeps.append, make_client=FakeClient)

    def test_no_saved_session(self):
        saved_session.clear()
        self.assertEqual(self.run_login([], False), (None, None, ""))

    def test_valid_token_signs_in(self):
        client, user, notice = self.run_login([{"username": "admin"}], False)
        self.assertEqual((client.token, user["username"], notice), ("tok", "admin", ""))

    def test_rejected_token_is_cleared(self):
        client, user, notice = self.run_login([ApiError("x", 401)], True)
        self.assertEqual((client, user, notice), (None, None, autologin.EXPIRED_NOTICE))
        self.assertIsNone(saved_session.load())

    def test_autostart_retries_while_network_comes_up(self):
        client, user, _ = self.run_login([ApiError("無法連線", 0), ApiError("down", 503), {"username": "admin"}], True)
        self.assertEqual(client.calls, 3)
        self.assertEqual(self.sleeps, [autologin.RETRY_SECONDS] * 2)

    def test_manual_start_tries_once_and_keeps_session(self):
        result = self.run_login([ApiError("無法連線", 0)], False)
        self.assertEqual(result, (None, None, autologin.OFFLINE_NOTICE))
        self.assertEqual(self.sleeps, [])
        self.assertIsNotNone(saved_session.load())

    def test_gives_up_after_all_attempts(self):
        result = self.run_login([ApiError("無法連線", 0)] * autologin.AUTOSTART_ATTEMPTS, True)
        self.assertEqual(result[2], autologin.OFFLINE_NOTICE)
        self.assertEqual(len(self.sleeps), autologin.AUTOSTART_ATTEMPTS - 1)

    def test_total_wait_is_bounded_to_about_a_minute(self):
        self.run_login([ApiError("無法連線", 0)] * autologin.AUTOSTART_ATTEMPTS, True)
        client = FakeClient.last
        worst = sum(client.timeouts) + sum(self.sleeps)
        self.assertLessEqual(worst, 65)
        self.assertTrue(all(t == autologin.ATTEMPT_TIMEOUT for t in client.timeouts))


if __name__ == "__main__":
    unittest.main()
