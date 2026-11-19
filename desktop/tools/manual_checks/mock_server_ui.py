"""Automated offscreen UI testing script for ClubDesk.

Runs an in-process mock server that responds to all back-end endpoints,
boots PySide6 with QT_QPA_PLATFORM=offscreen, exercises each page and dialog,
catches any runtime exceptions, and captures screenshots.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

# Ensure desktop/ is on Python path
DESKTOP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if DESKTOP_DIR not in sys.path:
    sys.path.insert(0, DESKTOP_DIR)

os.environ["QT_QPA_PLATFORM"] = "offscreen"

from clubdesk import qtcompat  # noqa: E402,F401  (PySide2 fallback)


class MockApiHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Quiet logging

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        routes = {
            "/api/me": {"username": "admin", "role": "president", "name": "管理員"},
            "/api/messages/summary": {
                "unreadMessages": 2,
                "unreadAnnouncements": 1,
                "conversations": [
                    {"conv": "general", "name": "一般討論", "kind": "channel", "lastAt": "2026-11-18T12:00:00Z",
                     "lastAuthor": "admin", "lastPreview": "歡迎大家加入！", "unread": 2}
                ],
                "announcements": [
                    {"id": "a1", "title": "【重要】115-1 期初社員大會通知", "date": "2026-11-18"}
                ],
            },
            "/api/messages/people": {
                "me": {"username": "admin", "name": "管理員", "officer": True, "president": True},
                "people": [
                    {"username": "admin", "name": "管理員", "role": "president", "roleLabel": "社長"},
                    {"username": "cadre1", "name": "李幹部", "role": "cadre", "roleLabel": "幹部"},
                    {"username": "user1", "name": "王小明", "role": "member", "roleLabel": "社員"},
                ],
            },
            "/api/messages/conversations": [
                {"conv": "general", "name": "一般討論", "kind": "channel", "audience": "all",
                 "audienceLabel": "全體社員", "lastAt": "2026-11-18T12:00:00Z", "lastAuthor": "admin",
                 "lastPreview": "歡迎大家加入！", "unread": 2},
                {"conv": "dm~user1", "name": "王小明", "kind": "dm", "with": "user1",
                 "lastAt": "2026-11-18T11:00:00Z", "lastAuthor": "user1", "lastPreview": "請問這週有社課嗎？", "unread": 0},
            ],
            "/api/messages/c/general": {
                "conv": "general",
                "messages": [
                    {"seq": 1, "author": "admin", "text": "大家好，歡迎加入北科無人機社！", "createdAt": "2026-11-18T10:00:00Z"},
                    {"seq": 2, "author": "user1", "text": "社長好！想請問新手第一次要帶什麼？", "createdAt": "2026-11-18T10:05:00Z"},
                ],
            },
            "/api/messages/c/dm~user1": {
                "conv": "dm~user1",
                "messages": [
                    {"seq": 1, "author": "user1", "text": "請問這週有社課嗎？", "createdAt": "2026-11-18T11:00:00Z"}
                ],
            },
            "/api/messages/push-settings": {
                "discord": "https://discord.com/api/webhooks/mock",
                "slack": "",
                "googleChat": "",
                "teams": "",
                "line": "",
            },
            "/api/announcements": [
                {"id": "a1", "title": "【重要】115-1 期初社員大會通知", "category": "活動", "published": True,
                 "date": "2026-11-18", "author": "admin", "content": "時間：11/20 19:00\n地點：綜科館 301", "views": 25, "read": False}
            ],
            "/api/posts": [
                {"slug": "fpv-drone-101", "title": "FPV 穿越機基礎指南", "date": "2026-11-10", "lang": "zh",
                 "views": 88, "pinned": True, "summary": "從零開始打造屬於自己的穿越機。"}
            ],
            "/api/posts/fpv-drone-101": {
                "slug": "fpv-drone-101", "title": "FPV 穿越機基礎指南", "date": "2026-11-10", "lang": "zh",
                "views": 88, "pinned": True, "summary": "從零開始打造屬於自己的穿越機。",
                "content": "# FPV 穿越機基礎\n\n穿越機是非常迷人的飛行載具。"
            },
            "/api/pages": [
                {"slug": "about", "title": "關於社團", "lang": "zh", "summary": "北科無人機社簡介"}
            ],
            "/api/pages/about": {
                "slug": "about", "title": "關於社團", "lang": "zh", "summary": "北科無人機社簡介",
                "content": "# 關於我們\n\n國立臺北科技大學無人機社成立於 2024 年。"
            },
            "/api/homepage": {
                "heroTitle": "國立臺北科技大學 無人機社",
                "heroDesc": "探索上帝視角的無限精彩，動手組裝、競速飛行與考照特訓。",
                "heroBadge": "學務處課外組核可康樂性社團",
            },
            "/api/notes": [
                {"id": "n1", "title": "第 1 次社課：穿越機構造與 Betaflight 設定", "date": "2026-10-05",
                 "content": "介紹機架、飛控、電變、馬達與接收機連接方式。",
                 "links": [{"label": "教學簡報", "url": "https://example.com/slides"}], "createdBy": "admin"}
            ],
            "/api/members": [
                {"id": "m1", "studentId": "111590001", "name": "王小明", "department": "電子工程系",
                 "grade": "二", "phone": "0912-345-678", "email": "m1@example.com", "role": "member",
                 "status": {"levelLabel": "一般社員", "feeLabel": "已繳", "active": True}, "joinedAt": "2026-09-01"},
                {"id": "m2", "studentId": "110590002", "name": "李幹部", "department": "機械工程系",
                 "grade": "三", "phone": "0922-333-444", "email": "m2@example.com", "role": "cadre",
                 "status": {"levelLabel": "幹部", "feeLabel": "已繳", "active": True}, "joinedAt": "2025-09-01"}
            ],
            "/api/member-fee-receipts": [
                {"id": "r1", "receiptNo": "115-001", "studentId": "111590001", "name": "王小明",
                 "semester": "115-1", "amount": 500, "paymentMethod": "cash", "paidAt": "2026-09-15", "issuedBy": "admin"}
            ],
            "/api/finance/summary": {
                "balance": 28600, "income": 35000, "expense": 6400, "pendingCount": 0,
                "transactions": [
                    {"id": "t1", "date": "2026-10-01", "type": "expense", "category": "活動費",
                     "amount": 1200, "description": "購買練習螺旋槳 10 組", "status": "approved", "receiptUrl": ""}
                ],
                "budgets": [{"id": "b1", "category": "活動費", "allocated": 10000, "spent": 1200}]
            },
            "/api/equipment": [
                {"id": "eq1", "assetNo": "DRN-001", "name": "DJI Avata 2 暢飛套裝", "category": "無人機",
                 "status": "available", "location": "社辦防潮箱 A1", "note": "含 3 顆電池、飛行眼鏡 3"}
            ],
            "/api/forms": [
                {"id": "f1", "type": "equipment-loan", "createdAt": "2026-11-01",
                 "data": {"borrower": "王小明", "items": "DJI Mini 3"}}
            ],
            "/api/forms/settings": {
                "clubNameZh": "國立臺北科技大學無人機研究社", "clubNameEn": "NTUT Drone Club",
                "ai": {"provider": "groq", "model": "llama-3.3-70b-versatile"}
            },
            "/api/meetings": {
                "meetings": [
                    {"id": "meet1", "type": "assembly", "title": "115-1 期初社員大會", "date": "2026-11-20",
                     "time": "19:00", "location": "綜合科館 301", "status": "draft", "attendanceCount": 0,
                     "agenda": [{"id": "a1", "kind": "report", "title": "社長工作報告", "threshold": "none"}]}
                ],
                "types": {"assembly": "社員大會", "officers": "幹部會議", "general": "一般會議"}
            },
            "/api/ai/status": {
                "enabled": True, "configured": True, "provider": "Groq", "model": "llama-3.3-70b-versatile", "dailyLimit": 30
            },
            "/api/ai/reports": [
                {"id": "rep1", "week": "2026-W46", "title": "第 46 週社務週報", "createdAt": "2026-11-17T09:00:00Z",
                 "text": "本週完成社課與期初大會籌備工作，財務收支與設備狀態一切正常。", "trigger": "cron", "webhook": "sent"}
            ],
            "/api/users": [
                {"username": "admin", "role": "president", "active": True, "createdAt": "2026-09-01T00:00:00Z",
                 "member": {"name": "管理員", "studentId": "110590000", "status": {"levelLabel": "社長", "feeLabel": "已繳"}}},
                {"username": "user1", "role": "member", "active": True, "createdAt": "2026-09-10T00:00:00Z",
                 "member": {"name": "王小明", "studentId": "111590001", "status": {"levelLabel": "一般社員", "feeLabel": "已繳"}}}
            ],
            "/api/site-settings": {
                "siteName": "國立臺北科技大學無人機社", "memberLogin": True, "allowRegistration": False
            },
            "/api/regulations": [
                {"chapter": "第一章 總則", "articles": [
                    {"number": "第一條", "title": "名稱", "content": "本社定名為「國立臺北科技大學無人機研究社」（以下簡稱本社）。"},
                    {"number": "第二條", "title": "宗旨", "content": "本社以推廣無人機科學技術、飛行運動與空拍攝影為宗旨。"}
                ]}
            ],
            "/api/desktop/version": {
                "version": "1.2.0",
                "url": "https://github.com/jhuiry8/ntutdroneweb/releases/download/desktop-v1.2.0/ClubDesk-Setup-1.2.0.exe",
                "sha256": "0" * 64,
                "notes": "1.2.0 版更新",
                "mandatory": False
            }
        }

        # Handle exact match or prefix
        if path in routes:
            self.send_json(200, routes[path])
            return

        # Fallback 404
        self.send_json(404, {"error": f"Not found: {path}"})

    def send_json(self, status: int, data: dict | list, extra_headers: dict | None = None) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length > 0 else b""

        if path == "/api/captcha":
            svg = ("<svg xmlns='http://www.w3.org/2000/svg' width='180' height='60'>"
                   "<rect width='100%' height='100%' fill='#f4f1e8'/><text x='20' y='40'>TEST1</text></svg>")
            self.send_json(200, {"id": "cap1", "svg": svg})
            return

        if path == "/api/login":
            self.send_json(302, {"ok": True}, {"Set-Cookie": "session=mock-token-123; Path=/; HttpOnly", "Location": "/admin"})
            return

        if path == "/api/preview":
            self.send_json(200, {"html": "<h3>預覽標題</h3><p>測試預覽內容</p>"})
            return

        if path == "/api/ai/assistant":
            self.send_json(200, {"reply": "您好！我是社務助理，有什麼需要幫忙的嗎？", "actions": [], "tools": []})
            return

        if path == "/api/messages/push-test":
            self.send_json(200, {"ok": True})
            return

        if path.startswith("/api/messages/c/") and path.endswith("/read"):
            self.send_json(200, {"ok": True})
            return

        if path == "/api/messages/read-all":
            self.send_json(200, {"ok": True})
            return

        # Generic 200 response for posts
        self.send_json(200, {"success": True})

    def do_PUT(self):
        self.send_json(200, {"success": True})

    def do_PATCH(self):
        self.send_json(200, {"success": True})

    def do_DELETE(self):
        self.send_json(200, {"success": True})


def start_mock_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), MockApiHandler)
    port = server.server_port
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{port}"


def run_tests():
    from PySide6.QtCore import QTimer
    from PySide6.QtWidgets import QApplication

    from clubdesk.api import ApiClient
    from clubdesk.help import HelpWindow, WelcomeDialog
    from clubdesk.login import LoginDialog
    from clubdesk.mainwindow import MainWindow
    from clubdesk.pages.admin import NoteDialog
    from clubdesk.pages.meetings import MeetingDialog
    from clubdesk.pages.messages import ChannelDialog, PushSettingsDialog
    from clubdesk.pages.website import ContentEditor, TableDialog
    from clubdesk.updater import PublishDialog

    screenshots_dir = os.path.join(DESKTOP_DIR, "screenshots")
    os.makedirs(screenshots_dir, exist_ok=True)

    server, base_url = start_mock_server()
    print(f"[1/7] Mock server running at {base_url}")

    app = QApplication.instance() or QApplication(["ClubDeskTest"])
    api = ApiClient(base_url)
    api.token = "mock-token-123"

    print("[2/7] Testing LoginDialog...")
    login = LoginDialog()
    login.server.setText(base_url)
    login.server_changed()
    login.show()
    app.processEvents()
    time.sleep(0.3)
    app.processEvents()
    login.grab().save(os.path.join(screenshots_dir, "00_login_dialog.png"))
    login.close()
    print("  -> LoginDialog rendered and screenshot saved.")

    print("[3/7] Booting MainWindow as President...", flush=True)
    from clubdesk import __version__
    from PySide6.QtCore import QSettings
    QSettings().setValue("welcome/version", __version__)

    user = {"username": "admin", "role": "president", "name": "管理員"}
    win = MainWindow(api, user)
    win.poll.stop()  # Stop background polling during test runner
    win.show()
    app.processEvents()
    time.sleep(0.3)
    app.processEvents()

    print(f"[4/7] Testing and screenshotting all {len(win.pages)} MainWindow pages...", flush=True)
    for idx, page in enumerate(win.pages):
        page_title = getattr(page, "title", page.__class__.__name__)
        print(f"  [{idx + 1:02d}/{len(win.pages):02d}] Loading {page.__class__.__name__}: {page_title}")
        win.show_page(idx)
        app.processEvents()
        page.ensure_loaded()
        # Allow any QThreadPool jobs or timers to process
        for _ in range(10):
            time.sleep(0.05)
            app.processEvents()
        clean_name = f"{idx + 1:02d}_{page.__class__.__name__}"
        path = os.path.join(screenshots_dir, f"page_{clean_name}.png")
        win.grab().save(path)
        print(f"       -> Saved {path}")

    print("[5/7] Testing standalone dialogs...")
    # 1. WelcomeDialog
    welcome = WelcomeDialog(win)
    welcome.show()
    app.processEvents()
    welcome.grab().save(os.path.join(screenshots_dir, "dialog_welcome.png"))
    welcome.close()

    # 2. HelpWindow
    help_win = HelpWindow(win)
    help_win.show()
    app.processEvents()
    help_win.grab().save(os.path.join(screenshots_dir, "dialog_help.png"))
    help_win.close()

    # 3. PushSettingsDialog
    push = PushSettingsDialog(win, api)
    push.show()
    app.processEvents()
    push.grab().save(os.path.join(screenshots_dir, "dialog_push_settings.png"))
    push.close()

    # 4. PublishDialog
    publish = PublishDialog(win, api)
    publish.show()
    app.processEvents()
    publish.grab().save(os.path.join(screenshots_dir, "dialog_publish.png"))
    publish.close()

    # 5. ContentEditor (Post)
    sample_post = {"slug": "fpv-101", "title": "FPV 穿越機指南", "date": "2026-11-18", "lang": "zh", "content": "# 測試內文"}
    editor = ContentEditor(win, api, "post", sample_post, ai_enabled=True)
    editor.show()
    app.processEvents()
    editor.grab().save(os.path.join(screenshots_dir, "dialog_post_editor.png"))
    editor.close()

    # 6. TableDialog
    table_dlg = TableDialog(win)
    table_dlg.show()
    app.processEvents()
    table_dlg.grab().save(os.path.join(screenshots_dir, "dialog_table.png"))
    table_dlg.close()

    # 7. ChannelDialog
    people = [{"username": "user1", "name": "王小明", "roleLabel": "社員"}]
    channel_dlg = ChannelDialog(win, people)
    channel_dlg.show()
    app.processEvents()
    channel_dlg.grab().save(os.path.join(screenshots_dir, "dialog_channel.png"))
    channel_dlg.close()

    # 8. MeetingDialog
    meeting_opts = {"types": {"assembly": "社員大會", "officers": "幹部會議"}}
    meeting_dlg = MeetingDialog(win, meeting_opts)
    meeting_dlg.show()
    app.processEvents()
    meeting_dlg.grab().save(os.path.join(screenshots_dir, "dialog_meeting.png"))
    meeting_dlg.close()

    # 9. NoteDialog
    note_dlg = NoteDialog(win)
    note_dlg.show()
    app.processEvents()
    note_dlg.grab().save(os.path.join(screenshots_dir, "dialog_note.png"))
    note_dlg.close()

    win.close()
    print("  -> All standalone dialogs exercised and captured.")

    print("[6/7] Booting MainWindow as Member (role=member)...", flush=True)
    member_user = {"username": "user1", "role": "member", "name": "王小明"}
    member_win = MainWindow(api, member_user)
    member_win.poll.stop()
    member_win.show()
    app.processEvents()
    time.sleep(0.2)
    app.processEvents()
    member_win.grab().save(os.path.join(screenshots_dir, "99_member_mainwindow.png"))
    print(f"  -> Member view has {len(member_win.pages)} pages (restricted from {len(win.pages)}).", flush=True)
    member_win.close()

    print("[7/7] All offscreen tests completed successfully!", flush=True)
    server.shutdown()


if __name__ == "__main__":
    run_tests()
