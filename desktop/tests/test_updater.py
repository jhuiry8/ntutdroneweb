"""Version comparison and GitHub Release parsing for the update check."""

import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    from clubdesk import updater
except ImportError as error:  # PySide6 or its system libraries missing
    updater = None
    SKIP = str(error)


@unittest.skipIf(updater is None, "PySide6 unavailable")
class VersionTests(unittest.TestCase):
    def test_is_newer(self):
        self.assertTrue(updater.is_newer("1.10.0", "1.9.9"))
        self.assertTrue(updater.is_newer("2.0.0", "1.99.99"))
        self.assertFalse(updater.is_newer("1.1.0", "1.1.0"))
        self.assertFalse(updater.is_newer("1.0.9", "1.1.0"))
        self.assertFalse(updater.is_newer("", "1.1.0"))
        self.assertFalse(updater.is_newer("abc", "1.1.0"))

    def test_latest_release_only_when_newer(self):
        api = mock.Mock()
        api.request.return_value = {"version": "99.0.0", "url": "https://github.com/x.exe", "sha256": "a" * 64}
        self.assertEqual(updater.latest_release(api)["version"], "99.0.0")
        api.request.return_value = {"version": None}
        self.assertIsNone(updater.latest_release(api))
        api.request.return_value = {"version": "0.0.1"}
        self.assertIsNone(updater.latest_release(api))

    def test_github_release_parsing_prefers_desktop_tags(self):
        releases = [
            {"tag_name": "web-v3", "assets": [{"name": "x.exe"}]},
            {"tag_name": "desktop-v1.2.0", "draft": False,
             "body": "新增表單作業\n\nSHA-256: " + "b" * 64,
             "assets": [{"name": "ClubDesk-Setup-1.2.0.exe", "browser_download_url": "https://github.com/a/b/c.exe"}]},
        ]
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(releases).encode()
        with mock.patch.object(updater.urllib.request, "urlopen", return_value=response):
            release = updater.github_latest_release()
        self.assertEqual(release, {"version": "1.2.0", "url": "https://github.com/a/b/c.exe",
                                   "sha256": "b" * 64, "notes": "新增表單作業"})


if __name__ == "__main__":
    unittest.main()
