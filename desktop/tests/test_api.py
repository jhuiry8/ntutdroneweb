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
            reply(200, [{"slug": "hello", "title": "Hello"}]),
            reply(200, {"slug": "hello", "title": "Hello", "content": "Hi"}),
            reply(200, {"success": True, "slug": "hello-new"}),
            reply(200, {"success": True}),
            reply(200, {"html": "<p>Preview</p>"}),
        )
        self.assertEqual(len(api.posts()), 1)
        self.assertEqual(sent.calls[0]["url"], "https://club.example/api/posts")

        post = api.get_post("hello/special")
        self.assertEqual(sent.calls[1]["url"], "https://club.example/api/posts/hello%2Fspecial")
        self.assertEqual(post["title"], "Hello")

        api.save_post({"title": "New", "content": "body"}, original_slug="hello")
        self.assertEqual(sent.calls[2]["method"], "POST")
        self.assertEqual(sent.calls[2]["url"], "https://club.example/api/posts")
        self.assertEqual(sent.json_body(2), {"title": "New", "content": "body", "originalSlug": "hello"})

        api.delete_post("hello-new")
        self.assertEqual(sent.calls[3]["method"], "DELETE")
        self.assertEqual(sent.calls[3]["url"], "https://club.example/api/posts/hello-new")

        html = api.preview_markdown("# Title")
        self.assertEqual(html, "<p>Preview</p>")
        self.assertEqual(sent.json_body(4), {"content": "# Title"})

    def test_pages_and_homepage_and_notes(self):
        api, sent = client(
            reply(200, [{"slug": "about"}]),
            reply(200, {"slug": "about", "title": "About"}),
            reply(200, {"success": True}),
            reply(200, {"success": True}),
            reply(200, {"hero": "Welcome"}),
            reply(200, {"success": True}),
            reply(200, [{"id": "n1", "content": "Note 1"}]),
            reply(201, {"id": "n2"}),
            reply(200, {"success": True}),
        )
        self.assertEqual(len(api.pages()), 1)
        self.assertEqual(api.get_page("about")["title"], "About")
        api.save_page({"title": "About", "content": "ABC"}, original_slug="old-about")
        self.assertEqual(sent.json_body(2)["originalSlug"], "old-about")
        api.delete_page("about")
        self.assertEqual(sent.calls[3]["method"], "DELETE")

        home = api.homepage()
        self.assertEqual(home["hero"], "Welcome")
        api.save_homepage({"hero": "Updated"})
        self.assertEqual(sent.json_body(5), {"hero": "Updated"})

        self.assertEqual(len(api.notes()), 1)
        api.create_note({"content": "Meeting note"})
        self.assertEqual(sent.json_body(7), {"content": "Meeting note"})
        api.delete_note("n1")
        self.assertEqual(sent.calls[8]["method"], "DELETE")
        self.assertEqual(sent.calls[8]["url"], "https://club.example/api/notes/n1")


class MessagesTests(unittest.TestCase):
    def test_conversations_and_messages_flow(self):
        api, sent = client(
            reply(200, {"unread": 3}),
            reply(200, [{"id": "general", "name": "General"}]),
            reply(200, {"users": ["alice", "bob"]}),
            reply(200, {"messages": [{"seq": 1, "text": "Hi"}]}),
            reply(201, {"seq": 2, "text": "Hello"}),
            reply(200, {"seq": 2, "text": "Edited"}),
            reply(200, {"success": True}),
            reply(200, {"success": True}),
            reply(200, {"success": True}),
            reply(200, {"id": "dm~alice"}),
        )
        self.assertEqual(api.message_summary(), {"unread": 3})
        self.assertEqual(len(api.conversations()), 1)
        self.assertEqual(len(api.people()["users"]), 2)

        msgs = api.messages("general", after=10, limit=50)
        self.assertEqual(sent.calls[3]["url"], "https://club.example/api/messages/c/general?after=10&limit=50")
        self.assertEqual(len(msgs["messages"]), 1)

        api.send_message("dm~alice", "Hello")
        self.assertEqual(sent.calls[4]["url"], "https://club.example/api/messages/c/dm~alice")
        self.assertEqual(sent.json_body(4), {"text": "Hello"})

        api.edit_message("general", 2, "Edited")
        self.assertEqual(sent.calls[5]["method"], "PATCH")
        self.assertEqual(sent.calls[5]["url"], "https://club.example/api/messages/c/general/2")
        self.assertEqual(sent.json_body(5), {"text": "Edited"})

        api.delete_message("general", 2)
        self.assertEqual(sent.calls[6]["method"], "DELETE")
        self.assertEqual(sent.calls[6]["url"], "https://club.example/api/messages/c/general/2")

        api.mark_read("general", 2)
        self.assertEqual(sent.calls[7]["url"], "https://club.example/api/messages/c/general/read")
        self.assertEqual(sent.json_body(7), {"seq": 2})

        api.mark_all_read()
        self.assertEqual(sent.calls[8]["url"], "https://club.example/api/messages/read-all")

        dm = api.open_dm("alice")
        self.assertEqual(sent.calls[9]["url"], "https://club.example/api/messages/dm")
        self.assertEqual(sent.json_body(9), {"username": "alice"})
        self.assertEqual(dm["id"], "dm~alice")

    def test_channels_announcements_and_push(self):
        api, sent = client(
            reply(201, {"id": "c1"}),
            reply(200, {"success": True}),
            reply(200, [{"id": "a1", "title": "Announcement"}]),
            reply(201, {"id": "a2"}),
            reply(200, {"success": True}),
            reply(200, {"success": True}),
            reply(200, {"success": True}),
            reply(200, {"discord": "https://discord.com/..."}),
            reply(200, {"success": True}),
            reply(200, {"ok": True}),
        )
        api.create_channel({"name": "projects", "topic": "Project discussion"})
        self.assertEqual(sent.calls[0]["url"], "https://club.example/api/messages/channels")
        self.assertEqual(sent.json_body(0), {"name": "projects", "topic": "Project discussion"})

        api.update_channel("c1", {"topic": "Updated topic"})
        self.assertEqual(sent.calls[1]["method"], "PATCH")
        self.assertEqual(sent.calls[1]["url"], "https://club.example/api/messages/channels/c1")

        self.assertEqual(len(api.announcements()), 1)
        api.create_announcement({"title": "A2", "content": "Body"})
        self.assertEqual(sent.calls[3]["url"], "https://club.example/api/announcements")

        api.update_announcement("a2", {"title": "A2 edit"})
        self.assertEqual(sent.calls[4]["method"], "PATCH")
        self.assertEqual(sent.calls[4]["url"], "https://club.example/api/announcements/a2")

        api.delete_announcement("a2")
        self.assertEqual(sent.calls[5]["method"], "DELETE")
        self.assertEqual(sent.calls[5]["url"], "https://club.example/api/announcements/a2")

        api.read_announcement("a1")
        self.assertEqual(sent.calls[6]["url"], "https://club.example/api/announcements/a1/read")

        push = api.push_settings()
        self.assertIn("discord", push)
        api.save_push_settings({"discord": "https://..."})
        self.assertEqual(sent.calls[8]["method"], "PUT")
        self.assertEqual(sent.calls[8]["url"], "https://club.example/api/messages/push-settings")

        test_res = api.push_test()
        self.assertTrue(test_res["ok"])
        self.assertEqual(sent.calls[9]["url"], "https://club.example/api/messages/push-test")


class MeetingsTests(unittest.TestCase):
    def test_meetings_and_agenda_flows(self):
        api, sent = client(
            reply(200, {"meetings": [{"id": "m1", "title": "First Meeting"}]}),
            reply(201, {"id": "m2"}),
            reply(200, {"success": True}),
            reply(200, {"success": True}),
            reply(200, {"status": "in_progress"}),
            reply(200, {"success": True}),
            reply(200, {"success": True}),
            reply(200, {"vote": "started"}),
        )
        self.assertEqual(len(api.meetings()["meetings"]), 1)
        self.assertEqual(sent.calls[0]["url"], "https://club.example/api/meetings")

        api.create_meeting({"title": "Meeting 2", "date": "2026-12-01"})
        self.assertEqual(sent.calls[1]["url"], "https://club.example/api/meetings")
        self.assertEqual(sent.json_body(1)["title"], "Meeting 2")

        api.update_meeting("m2", {"title": "Meeting 2 rename"})
        self.assertEqual(sent.calls[2]["method"], "PATCH")
        self.assertEqual(sent.calls[2]["url"], "https://club.example/api/meetings/m2")

        api.delete_meeting("m2")
        self.assertEqual(sent.calls[3]["method"], "DELETE")

        res = api.meeting_action("m1", "status", {"status": "in_progress"})
        self.assertEqual(res["status"], "in_progress")
        self.assertEqual(sent.calls[4]["url"], "https://club.example/api/meetings/m1/status")

        api.save_minutes("m1", {"minutes": "All agreed"})
        self.assertEqual(sent.calls[5]["method"], "PUT")
        self.assertEqual(sent.calls[5]["url"], "https://club.example/api/meetings/m1/minutes")
        self.assertEqual(sent.json_body(5), {"minutes": "All agreed"})

        api.agenda_action("m1", "item-1", "notes", {"notes": "Discussion note"})
        self.assertEqual(sent.calls[6]["url"], "https://club.example/api/meetings/m1/agenda/item-1/notes")
        self.assertEqual(sent.json_body(6), {"notes": "Discussion note"})

        api.agenda_action("m1", "item-1", "vote", {"options": ["A", "B"]})
        self.assertEqual(sent.calls[7]["url"], "https://club.example/api/meetings/m1/agenda/item-1/vote")


class AiAndAdminTests(unittest.TestCase):
    def test_ai_status_assistant_and_reports(self):
        api, sent = client(
            reply(200, {"configured": True, "provider": "groq"}),
            reply(200, {"reply": "Hello there", "actions": []}),
            reply(200, {"result": "Polished text"}),
            reply(200, {"suggestions": ["Recheck item 3"]}),
            reply(200, {"members": [{"name": "Student A"}]}),
            reply(200, [{"id": "r1", "title": "Weekly Report"}]),
            reply(201, {"id": "r2", "title": "New Report"}),
        )
        self.assertTrue(api.ai_status()["configured"])

        res = api.ai_assistant([{"role": "user", "content": "Help me"}])
        self.assertEqual(res["reply"], "Hello there")
        self.assertEqual(sent.calls[1]["url"], "https://club.example/api/ai/assistant")

        content_res = api.ai_content("polish", {"text": "draft"}, notes="Make it formal")
        self.assertEqual(content_res["result"], "Polished text")
        self.assertEqual(sent.json_body(2)["action"], "polish")
        self.assertEqual(sent.json_body(2)["notes"], "Make it formal")

        finance_rev = api.ai_finance_review()
        self.assertEqual(finance_rev["suggestions"], ["Recheck item 3"])

        import_res = api.ai_member_import("110590001 王小明 電資一")
        self.assertEqual(len(import_res["members"]), 1)

        reports = api.reports()
        self.assertEqual(len(reports), 1)

        new_rep = api.create_report()
        self.assertEqual(new_rep["id"], "r2")

    def test_finance_equipment_users_and_settings(self):
        api, sent = client(
            reply(200, {"balance": 50000}),
            reply(200, [{"id": "b1", "category": "活動費"}]),
            reply(200, {"success": True}),
            reply(200, {"imported": 5}),
            reply(200, [{"id": "rec1"}]),
            reply(201, {"id": "rec2"}),
            reply(200, {"success": True}),
            reply(200, [{"id": "eq1", "name": "Drone 1"}]),
            reply(201, {"id": "eq2"}),
            reply(200, {"success": True}),
            reply(200, {"siteName": "NTUT Drone Club"}),
            reply(200, {"success": True}),
            reply(200, [{"username": "user1"}]),
            reply(201, {"username": "user2"}),
            reply(200, {"success": True}),
            reply(200, {"success": True}),
        )
        self.assertEqual(api.finance_summary()["balance"], 50000)

        api.save_budgets([{"category": "活動費", "amount": 10000}])
        self.assertEqual(sent.calls[1]["method"], "PUT")
        self.assertEqual(sent.calls[1]["url"], "https://club.example/api/finance/budgets")

        api.set_transaction_budget("tx-1", "b1")
        self.assertEqual(sent.calls[2]["method"], "PATCH")
        self.assertEqual(sent.calls[2]["url"], "https://club.example/api/finance/transactions/tx-1/budget")
        self.assertEqual(sent.json_body(2), {"budgetId": "b1"})

        res = api.import_transactions([{"date": "2026-11-01", "amount": 100}])
        self.assertEqual(res["imported"], 5)

        self.assertEqual(len(api.fee_receipts()), 1)
        api.create_fee_receipt({"studentId": "110590001", "amount": 500})
        self.assertEqual(sent.calls[5]["url"], "https://club.example/api/member-fee-receipts")
        api.delete_fee_receipt("rec1")
        self.assertEqual(sent.calls[6]["method"], "DELETE")

        self.assertEqual(len(api.equipment(q="Drone")), 1)
        self.assertEqual(sent.calls[7]["url"], "https://club.example/api/equipment?q=Drone")
        api.create_equipment({"name": "Battery", "category": "配件"})
        self.assertEqual(sent.calls[8]["url"], "https://club.example/api/equipment")
        api.update_equipment("eq1", {"status": "in_use"})
        self.assertEqual(sent.calls[9]["method"], "PATCH")

        settings = api.site_settings()
        self.assertEqual(settings["siteName"], "NTUT Drone Club")
        api.save_site_settings({"siteName": "New Name"})
        self.assertEqual(sent.calls[11]["method"], "PUT")
        self.assertEqual(sent.calls[11]["url"], "https://club.example/api/site-settings")

        self.assertEqual(len(api.users()), 1)
        api.create_user({"username": "user2", "role": "cadre"})
        self.assertEqual(sent.calls[13]["url"], "https://club.example/api/users")
        api.update_user({"username": "user2", "role": "member"})
        self.assertEqual(sent.calls[14]["method"], "PATCH")

        api.change_password("oldpw", "newpw")
        self.assertEqual(sent.calls[15]["url"], "https://club.example/api/change-password")
        self.assertEqual(sent.json_body(15), {"oldPassword": "oldpw", "newPassword": "newpw"})


if __name__ == "__main__":
    unittest.main()


class RememberLoginTests(unittest.TestCase):
    def test_remember_sends_flag_and_reads_session_lifetime(self):
        api, sent = client(
            reply(302, headers={"set-cookie": "session=tok; Path=/; HttpOnly; Max-Age=2592000; Secure; SameSite=Lax"}),
            reply(200, {"username": "admin", "role": "president"}),
        )
        api.login("admin", "pw123456", "id-1", "ABCDE", remember=True)
        self.assertEqual(parse_qs(sent.calls[0]["body"].decode())["remember"], ["1"])
        self.assertEqual(api.session_seconds, 30 * 86400)

    def test_without_remember_no_flag_is_sent(self):
        api, sent = client(
            reply(302, headers={"set-cookie": "session=tok; Max-Age=86400"}),
            reply(200, {"username": "admin", "role": "president"}),
        )
        api.login("admin", "pw123456", "id-1", "ABCDE")
        self.assertNotIn("remember", parse_qs(sent.calls[0]["body"].decode()))
        self.assertEqual(api.session_seconds, 86400)
