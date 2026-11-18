"""Unit tests for the back-end client. They use a fake HTTP session, so no server is needed.

Run from the desktop/ folder:  python -m unittest discover -s tests
"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import requests  # noqa: E402

from clubdesk.api import (ApiClient, ApiError, can_manage_finance, can_manage_members,  # noqa: E402
                          normalize_base_url, session_cookie)


class FakeResponse:
    def __init__(self, status=200, body=None, text=None, headers=None):
        self.status_code = status
        self._body = body
        self.text = text if text is not None else (json.dumps(body) if body is not None else "")
        self.headers = headers or {}

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class FakeSession:
    def __init__(self, *responses):
        self.headers = {}
        self.responses = list(responses)
        self.calls = []

    def _next(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def request(self, method, url, **kwargs):
        return self._next(method, url, **kwargs)

    def post(self, url, **kwargs):
        return self._next("POST", url, **kwargs)


LOGIN_PAGE_ERROR = ('<div style="color: #f87171;"><i data-lucide="alert-circle" style="width: 16px;"></i> '
                    '帳號或密碼不正確，請重新輸入！</div>')


class LoginTests(unittest.TestCase):
    def test_login_sends_form_and_keeps_session_cookie(self):
        session = FakeSession(
            FakeResponse(302, headers={"Set-Cookie": "session=abc-123; Path=/; HttpOnly; Max-Age=86400; Secure; SameSite=Lax"}),
            FakeResponse(200, {"username": "admin", "role": "president"}),
        )
        client = ApiClient("https://club.example", session)
        user = client.login("admin", "pw123456", "id-1", "ABCDE")
        self.assertEqual(user["role"], "president")
        method, url, kwargs = session.calls[0]
        self.assertEqual((method, url), ("POST", "https://club.example/api/login"))
        self.assertEqual(kwargs["data"], {"username": "admin", "password": "pw123456", "captcha_id": "id-1", "captcha": "ABCDE"})
        self.assertFalse(kwargs["allow_redirects"])
        self.assertEqual(session.calls[1][2]["headers"], {"Cookie": "session=abc-123"})

    def test_login_failure_shows_server_message(self):
        client = ApiClient("https://club.example", FakeSession(FakeResponse(200, text=LOGIN_PAGE_ERROR)))
        with self.assertRaises(ApiError) as caught:
            client.login("admin", "wrong", "id", "AAAAA")
        self.assertEqual(str(caught.exception), "帳號或密碼不正確，請重新輸入！")
        self.assertEqual(client.token, "")

    def test_turnstile_sites_explain_why_login_is_unavailable(self):
        client = ApiClient("https://club.example", FakeSession(FakeResponse(404, {"error": "未啟用"})))
        with self.assertRaises(ApiError) as caught:
            client.captcha()
        self.assertIn("Turnstile", str(caught.exception))

    def test_logout_clears_token_even_if_server_fails(self):
        client = ApiClient("https://club.example", FakeSession(requests.ConnectionError("down")))
        client.token = "abc"
        client.logout()
        self.assertEqual(client.token, "")


class RequestTests(unittest.TestCase):
    def test_server_error_message_is_raised(self):
        client = ApiClient("https://club.example", FakeSession(FakeResponse(409, {"error": "學號已存在"})))
        with self.assertRaises(ApiError) as caught:
            client.create_member({"name": "王小明"})
        self.assertEqual((str(caught.exception), caught.exception.status), ("學號已存在", 409))

    def test_connection_failure_becomes_api_error(self):
        client = ApiClient("https://club.example", FakeSession(requests.ConnectionError("refused")))
        with self.assertRaises(ApiError) as caught:
            client.members()
        self.assertIn("無法連線", str(caught.exception))

    def test_query_parameters_skip_empty_values_and_ids_are_quoted(self):
        session = FakeSession(FakeResponse(200, []), FakeResponse(200, {}))
        client = ApiClient("https://club.example/", session)
        client.members(q="王", filter="")
        client.update_member("a/b", {"phone": "1"})
        self.assertEqual(session.calls[0][2]["params"], {"q": "王"})
        self.assertEqual(session.calls[1][1], "https://club.example/api/members/a%2Fb")
        self.assertEqual(session.calls[1][0], "PATCH")

    def test_review_and_bulk_payloads(self):
        session = FakeSession(FakeResponse(200, {}), FakeResponse(200, {}))
        client = ApiClient("https://club.example", session)
        client.review_transaction("t1", "rejected", "收據不清楚")
        client.bulk_members(["m1", "m2"], action="delete")
        self.assertEqual(session.calls[0][1], "https://club.example/api/finance/transactions/t1/review")
        self.assertEqual(session.calls[0][2]["json"], {"status": "rejected", "note": "收據不清楚"})
        self.assertEqual(session.calls[1][2]["json"], {"ids": ["m1", "m2"], "action": "delete"})


class HelperTests(unittest.TestCase):
    def test_normalize_base_url(self):
        self.assertEqual(normalize_base_url(" club.example/ "), "https://club.example")
        self.assertEqual(normalize_base_url("http://127.0.0.1:8787/"), "http://127.0.0.1:8787")
        self.assertEqual(normalize_base_url(""), "")

    def test_session_cookie_ignores_other_cookies_and_logout_cookie(self):
        self.assertEqual(session_cookie(FakeResponse(headers={"Set-Cookie": "lang=zh; Path=/, session=xyz; Path=/"})), "xyz")
        self.assertEqual(session_cookie(FakeResponse(headers={"Set-Cookie": "session=; Max-Age=0"})), "")

    def test_permissions_match_web_rules(self):
        self.assertTrue(can_manage_members("finance"))
        self.assertFalse(can_manage_members("cadre"))
        self.assertFalse(can_manage_finance("member"))


class SemesterTests(unittest.TestCase):
    def test_semester_matches_membership_js(self):
        try:
            from clubdesk.pages.members import semester_of
        except ImportError as error:  # PySide6 or its system libraries missing
            self.skipTest(str(error))
        from datetime import date
        self.assertEqual(semester_of(date(2026, 11, 15)), "115-1")
        self.assertEqual(semester_of(date(2027, 1, 10)), "115-1")
        self.assertEqual(semester_of(date(2027, 3, 1)), "115-2")


if __name__ == "__main__":
    unittest.main()
