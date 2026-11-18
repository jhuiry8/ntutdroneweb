"""Unit tests for the back-end client. They use a fake HTTP transport, so no server is needed.

Run from the desktop/ folder:  python -m unittest discover -s tests
"""

import json
import os
import sys
import unittest
from urllib.parse import parse_qs

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from clubdesk.api import (AI_TIMEOUT, ApiClient, ApiError, ConnectionFailed, Response,  # noqa: E402
                          can_manage_elections, can_manage_finance, can_manage_members,
                          normalize_base_url, session_cookie)


def reply(status=200, body=None, text=None, headers=None):
    return Response(status, headers or {}, text if text is not None else (json.dumps(body) if body is not None else ""))


class FakeTransport:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def send(self, method, url, headers, body, timeout):
        self.calls.append({"method": method, "url": url, "headers": headers, "body": body, "timeout": timeout})
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def json_body(self, index):
        return json.loads(self.calls[index]["body"].decode("utf-8"))


def client(*responses, base="https://club.example"):
    transport = FakeTransport(*responses)
    return ApiClient(base, transport), transport


LOGIN_PAGE_ERROR = ('<div style="color: #f87171;"><i data-lucide="alert-circle" style="width: 16px;"></i> '
                    '帳號或密碼不正確，請重新輸入！</div>')


class LoginTests(unittest.TestCase):
    def test_login_posts_form_and_keeps_session_cookie(self):
        api, sent = client(
            reply(302, headers={"set-cookie": "session=abc-123; Path=/; HttpOnly; Max-Age=86400; Secure; SameSite=Lax"}),
            reply(200, {"username": "admin", "role": "president"}),
        )
        user = api.login("admin", "pw123456", "id-1", "ABCDE")
        self.assertEqual(user["role"], "president")
        first = sent.calls[0]
        self.assertEqual((first["method"], first["url"]), ("POST", "https://club.example/api/login"))
        self.assertEqual(first["headers"]["Content-Type"], "application/x-www-form-urlencoded")
        self.assertEqual(parse_qs(first["body"].decode()), {"username": ["admin"], "password": ["pw123456"],
                                                            "captcha_id": ["id-1"], "captcha": ["ABCDE"]})
        self.assertNotIn("Cookie", first["headers"])
        self.assertEqual(sent.calls[1]["headers"]["Cookie"], "session=abc-123")

    def test_login_failure_shows_server_message(self):
        api, _ = client(reply(200, text=LOGIN_PAGE_ERROR))
        with self.assertRaises(ApiError) as caught:
            api.login("admin", "wrong", "id", "AAAAA")
        self.assertEqual(str(caught.exception), "帳號或密碼不正確，請重新輸入！")
        self.assertEqual(api.token, "")

    def test_turnstile_sites_explain_why_login_is_unavailable(self):
        api, _ = client(reply(404, {"error": "未啟用"}))
        with self.assertRaises(ApiError) as caught:
            api.captcha()
        self.assertIn("Turnstile", str(caught.exception))

    def test_logout_clears_token_even_if_server_fails(self):
        api, _ = client(ConnectionFailed("down"))
        api.token = "abc"
        api.logout()
        self.assertEqual(api.token, "")


class RequestTests(unittest.TestCase):
    def test_server_error_message_is_raised(self):
        api, _ = client(reply(409, {"error": "學號已存在"}))
        with self.assertRaises(ApiError) as caught:
            api.create_member({"name": "王小明"})
        self.assertEqual((str(caught.exception), caught.exception.status), ("學號已存在", 409))

    def test_connection_failure_becomes_api_error(self):
        api, _ = client(ConnectionFailed("refused"))
        with self.assertRaises(ApiError) as caught:
            api.members()
        self.assertIn("無法連線", str(caught.exception))

    def test_query_skips_empty_values_and_ids_are_quoted(self):
        api, sent = client(reply(200, []), reply(200, {}), base="https://club.example/")
        api.members(q="王", filter="")
        api.update_member("a/b", {"phone": "1"})
        self.assertEqual(sent.calls[0]["url"], "https://club.example/api/members?q=%E7%8E%8B")
        self.assertEqual(sent.calls[1]["url"], "https://club.example/api/members/a%2Fb")
        self.assertEqual(sent.calls[1]["method"], "PATCH")
        self.assertEqual(sent.json_body(1), {"phone": "1"})

    def test_review_and_bulk_payloads(self):
        api, sent = client(reply(200, {}), reply(200, {}))
        api.review_transaction("t1", "rejected", "收據不清楚")
        api.bulk_members(["m1", "m2"], action="delete")
        self.assertEqual(sent.calls[0]["url"], "https://club.example/api/finance/transactions/t1/review")
        self.assertEqual(sent.json_body(0), {"status": "rejected", "note": "收據不清楚"})
        self.assertEqual(sent.json_body(1), {"ids": ["m1", "m2"], "action": "delete"})


class FormTests(unittest.TestCase):
    def test_form_crud_routes(self):
        api, sent = client(reply(200, []), reply(201, {"id": "f1"}), reply(200, {}), reply(200, {}))
        api.forms("equipment-loan")
        api.create_form("equipment-loan", {"borrower": "王"})
        api.update_form("f1", {"borrower": "李"})
        api.delete_form("f1")
        self.assertEqual(sent.calls[0]["url"], "https://club.example/api/forms?type=equipment-loan")
        self.assertEqual(sent.json_body(1), {"type": "equipment-loan", "data": {"borrower": "王"}})
        self.assertEqual((sent.calls[2]["method"], sent.calls[2]["url"]), ("PUT", "https://club.example/api/forms/f1"))
        self.assertEqual(sent.json_body(2), {"data": {"borrower": "李"}})
        self.assertEqual(sent.calls[3]["method"], "DELETE")

    def test_ai_calls_wait_longer(self):
        api, sent = client(reply(200, {"fields": {}, "notes": ""}), reply(200, {"subject": "主旨", "descriptions": []}))
        api.ai_fill("expense-request", "買電池")
        api.ai_letter("請借場地", "簽")
        self.assertEqual(sent.json_body(0), {"type": "expense-request", "text": "買電池"})
        self.assertEqual(sent.json_body(1), {"text": "請借場地", "docType": "簽"})
        self.assertEqual(sent.calls[0]["timeout"], AI_TIMEOUT)

    def test_ai_not_configured_message(self):
        api, _ = client(reply(503, {"error": "尚未設定 GROQ_API_KEY，無法使用 AI 協助填寫"}))
        with self.assertRaises(ApiError) as caught:
            api.ai_fill("expense-request", "x")
        self.assertIn("GROQ_API_KEY", str(caught.exception))

    def test_print_page_and_expired_session(self):
        api, sent = client(reply(200, text="<html>A4</html>"), reply(302, headers={"location": "/admin"}))
        self.assertEqual(api.form_print_html("f1"), "<html>A4</html>")
        self.assertEqual(sent.calls[0]["url"], "https://club.example/admin/forms/print/f1")
        with self.assertRaises(ApiError) as caught:
            api.form_print_html(blank_type="expense-report")
        self.assertEqual(caught.exception.status, 401)
        self.assertEqual(sent.calls[1]["url"], "https://club.example/admin/forms/blank/expense-report")


class ElectionTests(unittest.TestCase):
    def test_election_routes(self):
        api, sent = client(reply(200, []), reply(201, {"id": "e1"}), reply(200, {}), reply(200, {}),
                           reply(200, {"voters": []}), reply(200, {"options": []}), reply(200, {}))
        api.elections()
        api.create_election({"title": "社長選舉", "candidates": []})
        api.update_election("e/1", {"title": "改"})
        api.election_status("e1", "open")
        api.election_audit("e1")
        api.election_results("e1")
        api.delete_election("e1")
        self.assertEqual(sent.calls[0]["url"], "https://club.example/api/elections")
        self.assertEqual(sent.json_body(1), {"title": "社長選舉", "candidates": []})
        self.assertEqual((sent.calls[2]["method"], sent.calls[2]["url"]), ("PUT", "https://club.example/api/elections/e%2F1"))
        self.assertEqual(sent.calls[3]["url"], "https://club.example/api/elections/e1/status")
        self.assertEqual(sent.json_body(3), {"action": "open"})
        self.assertEqual(sent.calls[4]["url"], "https://club.example/api/elections/e1/audit")
        self.assertEqual(sent.calls[5]["url"], "https://club.example/api/elections/e1/results")
        self.assertEqual(sent.calls[6]["method"], "DELETE")
        self.assertEqual(api.vote_page_url("e1"), "https://club.example/vote/e1")

    def test_only_president_message_is_shown(self):
        api, _ = client(reply(403, {"error": "只有社長可以開始、結束投票或公布結果"}))
        with self.assertRaises(ApiError) as caught:
            api.election_status("e1", "open")
        self.assertEqual(caught.exception.status, 403)
        self.assertIn("社長", str(caught.exception))

    def test_time_helpers_use_taiwan_time(self):
        try:
            from clubdesk.pages.elections import local_input, taipei_time
        except ImportError as error:  # PySide6 or its system libraries missing
            self.skipTest(str(error))
        self.assertEqual(taipei_time("2026-12-01T01:00:00.000Z"), "2026/12/01 09:00")
        self.assertEqual(local_input("2026-12-01T16:30:00.000Z"), "2026-12-02T00:30")
        self.assertEqual(taipei_time(""), "")


class HelperTests(unittest.TestCase):
    def test_normalize_base_url(self):
        self.assertEqual(normalize_base_url(" club.example/ "), "https://club.example")
        self.assertEqual(normalize_base_url("http://127.0.0.1:8787/"), "http://127.0.0.1:8787")
        self.assertEqual(normalize_base_url(""), "")

    def test_session_cookie_ignores_other_cookies_and_logout_cookie(self):
        self.assertEqual(session_cookie("lang=zh; Path=/\nsession=xyz; Path=/"), "xyz")
        self.assertEqual(session_cookie("session=; Max-Age=0"), "")

    def test_permissions_match_web_rules(self):
        self.assertTrue(can_manage_members("finance"))
        self.assertFalse(can_manage_members("cadre"))
        self.assertFalse(can_manage_finance("member"))
        self.assertTrue(can_manage_elections("cadre"))
        self.assertFalse(can_manage_elections("finance"))


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
