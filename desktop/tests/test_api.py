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
                          can_manage_finance, can_manage_members, normalize_base_url, session_cookie)


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


class WebsiteCmsTests(unittest.TestCase):
    def test_posts_crud_and_preview(self):
        api, sent = client(
            reply(200, [{"id": "p1", "title": "測試文章", "slug": "test"}]),
            reply(201, {"id": "p2", "slug": "new-post"}),
            reply(200, {"html": "<p>預覽</p>"}),
        )
        posts = api.posts()
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["slug"], "test")

        res = api.save_post({"title": "新文章", "slug": "new-post", "body": "內文"})
        self.assertEqual(res["id"], "p2")
        self.assertEqual(sent.calls[1]["method"], "POST")
        self.assertEqual(sent.calls[1]["url"], "https://club.example/api/posts")

        preview = api.preview_markdown("# 標題")
        self.assertIn("預覽", preview)
        self.assertEqual(sent.calls[2]["url"], "https://club.example/api/preview")

    def test_pages_and_homepage_and_notes(self):
        api, sent = client(
            reply(200, [{"id": "page1", "path": "about"}]),
            reply(200, {"heroTitle": "無人機社"}),
            reply(200, [{"id": "n1", "title": "第 1 週社課"}]),
        )
        pages = api.pages()
        self.assertEqual(len(pages), 1)

        hp = api.homepage()
        self.assertEqual(hp["heroTitle"], "無人機社")

        notes = api.notes()
        self.assertEqual(len(notes), 1)


class MessagesTests(unittest.TestCase):
    def test_conversations_and_messages_flow(self):
        api, sent = client(
            reply(200, {"unreadMessages": 2, "unreadAnnouncements": 1}),
            reply(200, [{"conv": "general", "name": "一般討論"}]),
            reply(200, {"messages": [{"seq": 1, "text": "嗨"}], "conv": "general"}),
            reply(200, {"seq": 2, "text": "測試"}),
        )
        summary = api.message_summary()
        self.assertEqual(summary["unreadMessages"], 2)

        convs = api.conversations()
        self.assertEqual(len(convs), 1)

        msgs = api.messages("general")
        self.assertEqual(len(msgs["messages"]), 1)

        send_res = api.send_message("general", "測試")
        self.assertEqual(send_res["seq"], 2)

    def test_channels_announcements_and_push(self):
        api, sent = client(
            reply(200, {"id": "ch1", "name": "新頻道"}),
            reply(200, [{"id": "a1", "title": "重要公告"}]),
            reply(200, {"enabled": False, "webhooks": []}),
        )
        ch = api.create_channel({"name": "新頻道"})
        self.assertEqual(ch["name"], "新頻道")

        anns = api.announcements()
        self.assertEqual(len(anns), 1)

        push = api.push_settings()
        self.assertFalse(push["enabled"])


class MeetingsTests(unittest.TestCase):
    def test_meetings_and_agenda_flows(self):
        api, sent = client(
            reply(200, {"meetings": [{"id": "m1", "title": "期初大會"}], "me": {"officer": True}}),
            reply(200, {"id": "m1", "title": "期初大會"}),
            reply(200, {"ok": True, "count": 1}),
        )
        data = api.meetings()
        self.assertEqual(len(data["meetings"]), 1)

        created = api.create_meeting({"title": "期初大會"})
        self.assertEqual(created["title"], "期初大會")

        checked = api.meeting_action("m1", "attendance", {"code": "1234"})
        self.assertTrue(checked["ok"])


class AiAndAdminTests(unittest.TestCase):
    def test_ai_status_assistant_and_reports(self):
        api, sent = client(
            reply(200, {"enabled": True, "provider": "groq"}),
            reply(200, {"reply": "社費收費標準為每學期 500 元"}),
            reply(200, [{"id": "r1", "title": "第 10 週社務週報"}]),
        )
        st = api.ai_status()
        self.assertTrue(st["enabled"])

        chat = api.ai_assistant([{"role": "user", "content": "社費多少？"}])
        self.assertIn("500", chat["reply"])

        reps = api.reports()
        self.assertEqual(len(reps), 1)

    def test_finance_equipment_users_and_settings(self):
        api, sent = client(
            reply(200, {"cash": 1000, "post": 5000}),
            reply(200, [{"id": "eq1", "name": "無人機"}]),
            reply(200, [{"username": "admin", "role": "president"}]),
        )
        finance = api.finance_summary()
        self.assertEqual(finance["cash"], 1000)

        eqs = api.equipment()
        self.assertEqual(len(eqs), 1)

        users = api.users()
        self.assertEqual(len(users), 1)



if __name__ == "__main__":
    unittest.main()


