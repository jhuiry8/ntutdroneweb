"""Client for the club website's back end (Cloudflare Workers, src/worker.js).

The desktop program uses the same /api/* routes as the web dashboard. Login
goes through the same form as the website: the server's image CAPTCHA is
fetched from /api/captcha and the answer is posted to /api/login together
with the user name and password. On success the server answers with a 302
redirect and a `session` cookie, which is then sent with every later call.

Only the Python standard library is used for HTTP (urllib), which keeps the
packaged program small.
"""

from __future__ import annotations

import json as jsonlib
import re
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from html import unescape
from urllib.parse import quote, urlencode, urljoin

TIMEOUT = 20
AI_TIMEOUT = 90  # AI calls wait for the language model
USER_AGENT = "NTUTDroneClubDesk/1.1"

ROLE_LABELS = {
    "president": "社長",
    "finance": "財務",
    "cadre": "幹部",
    "member": "社員",
}


# Same permission rules as src/auth.js.
def can_manage_users(role: str) -> bool:
    return role == "president"


def can_view_cms(role: str) -> bool:
    return role in ("president", "finance", "cadre")


def can_manage_finance(role: str) -> bool:
    return role in ("president", "finance")


def can_manage_members(role: str) -> bool:
    return role in ("president", "finance")


def can_manage_equipment(role: str) -> bool:
    return role in ("president", "finance", "cadre")


# Same rule as canManageElections in src/elections.js; opening, closing and
# publishing results are further limited to the president by the server.
def can_manage_elections(role: str) -> bool:
    return role in ("president", "cadre")


class ApiError(Exception):
    """An error reported by the server, or a connection failure."""

    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


class ConnectionFailed(Exception):
    pass


@dataclass
class Response:
    status: int
    headers: dict = field(default_factory=dict)  # lower-case names; Set-Cookie values joined by "\n"
    text: str = ""

    def json(self):
        return jsonlib.loads(self.text)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: D102 - keep 302 responses
        return None


class UrllibTransport:
    """Sends one HTTP request and never follows redirects."""

    def __init__(self):
        context = ssl.create_default_context()
        self.opener = urllib.request.build_opener(_NoRedirect(), urllib.request.HTTPSHandler(context=context))

    def send(self, method: str, url: str, headers: dict, body: bytes | None, timeout: float) -> Response:
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            raw = self.opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as error:  # 3xx/4xx/5xx still carry a body
            raw = error
        except (urllib.error.URLError, OSError, ValueError) as error:
            reason = getattr(error, "reason", error)
            raise ConnectionFailed(str(reason)) from error
        try:
            data = raw.read()
        except OSError as error:
            raise ConnectionFailed(str(error)) from error
        finally:
            raw.close()
        headers_out = {}
        for name, value in raw.headers.items():
            key = name.lower()
            headers_out[key] = f"{headers_out[key]}\n{value}" if key in headers_out else value
        charset = raw.headers.get_content_charset() or "utf-8"
        return Response(raw.status if hasattr(raw, "status") else raw.code, headers_out,
                        data.decode(charset, errors="replace"))


_LOGIN_ERROR = re.compile(r'alert-circle"[^>]*></i>\s*(.*?)\s*</div>', re.S)


class ApiClient:
    def __init__(self, base_url: str, transport=None):
        self.base_url = normalize_base_url(base_url)
        self.transport = transport or UrllibTransport()
        self.token = ""

    # ------------------------------------------------------------ transport
    def _url(self, path: str, params: dict | None = None) -> str:
        url = urljoin(self.base_url + "/", path.lstrip("/"))
        clean = {k: v for k, v in (params or {}).items() if v not in (None, "")}
        return f"{url}?{urlencode(clean)}" if clean else url

    def _send(self, method: str, url: str, *, body: bytes | None = None, content_type: str = "",
              timeout: float = TIMEOUT) -> Response:
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json, text/html"}
        if content_type:
            headers["Content-Type"] = content_type
        # The session cookie is marked Secure, so a cookie jar would drop it on
        # plain-http test servers (wrangler dev). Send it by hand instead.
        if self.token:
            headers["Cookie"] = f"session={self.token}"
        try:
            return self.transport.send(method, url, headers, body, timeout)
        except ConnectionFailed as error:
            raise ApiError(f"無法連線到伺服器：{error}") from error

    def request(self, method: str, path: str, *, params=None, json=None, timeout: float = TIMEOUT):
        body = None if json is None else jsonlib.dumps(json, ensure_ascii=False).encode("utf-8")
        response = self._send(method, self._url(path, params), body=body,
                              content_type="application/json" if body is not None else "", timeout=timeout)
        try:
            data = response.json()
        except ValueError:
            data = None
        if response.status >= 400:
            message = data.get("error") if isinstance(data, dict) else None
            if response.status == 401:
                message = message or "登入已逾時，請重新登入"
            raise ApiError(message or f"伺服器錯誤（HTTP {response.status}）", response.status)
        if data is None:
            raise ApiError("伺服器回應格式錯誤", response.status)
        return data

    def get(self, path, **params):
        return self.request("GET", path, params=params)

    def post(self, path, data=None, timeout: float = TIMEOUT):
        return self.request("POST", path, json=data or {}, timeout=timeout)

    def patch(self, path, data):
        return self.request("PATCH", path, json=data)

    def put(self, path, data):
        return self.request("PUT", path, json=data)

    def delete(self, path):
        return self.request("DELETE", path)

    # ---------------------------------------------------------------- login
    def captcha(self) -> dict:
        """Returns {"id": ..., "svg": ...}. Raises ApiError if the site uses Turnstile."""
        try:
            return self.post("/api/captcha")
        except ApiError as error:
            if error.status == 404:
                raise ApiError("此網站已改用 Cloudflare Turnstile 驗證，桌面程式無法登入。"
                               "請在網站設定中移除 TURNSTILE_SECRET_KEY，改用內建圖片驗證碼。", 404) from error
            raise

    def login(self, username: str, password: str, captcha_id: str, captcha_answer: str) -> dict:
        form = urlencode({"username": username, "password": password,
                          "captcha_id": captcha_id, "captcha": captcha_answer}).encode("utf-8")
        response = self._send("POST", self._url("/api/login"), body=form,
                              content_type="application/x-www-form-urlencoded")
        token = session_cookie(response.headers.get("set-cookie", ""))
        if response.status == 302 and token:
            self.token = token
            return self.me()
        match = _LOGIN_ERROR.search(response.text or "")
        message = unescape(re.sub(r"<[^>]+>", "", match.group(1))).strip() if match else ""
        raise ApiError(message or f"登入失敗（HTTP {response.status}）", response.status)

    def logout(self) -> None:
        if not self.token:
            return
        try:
            self.post("/api/logout")
        except ApiError:
            pass
        self.token = ""

    def me(self) -> dict:
        return self.get("/api/me")

    def change_password(self, old: str, new: str) -> dict:
        return self.post("/api/change-password", {"oldPassword": old, "newPassword": new})

    # -------------------------------------------------------------- members
    def members(self, q: str = "", filter: str = "") -> list:
        return self.get("/api/members", q=q, filter=filter)

    def create_member(self, fields: dict) -> dict:
        return self.post("/api/members", fields)

    def update_member(self, member_id: str, fields: dict) -> dict:
        return self.patch(f"/api/members/{quote(member_id, safe='')}", fields)

    def delete_member(self, member_id: str) -> dict:
        return self.delete(f"/api/members/{quote(member_id, safe='')}")

    def bulk_members(self, ids: list, **changes) -> dict:
        return self.post("/api/members/bulk", {"ids": ids, **changes})

    def import_members(self, rows: list) -> dict:
        return self.post("/api/members/import", {"rows": rows})

    # ---------------------------------------------------------- fee receipts
    def fee_receipts(self) -> list:
        return self.get("/api/member-fee-receipts")

    def create_fee_receipt(self, fields: dict) -> dict:
        return self.post("/api/member-fee-receipts", fields)

    def delete_fee_receipt(self, receipt_id: str) -> dict:
        return self.delete(f"/api/member-fee-receipts/{quote(receipt_id, safe='')}")

    # -------------------------------------------------------------- finance
    def finance_summary(self) -> dict:
        return self.get("/api/finance/summary")

    def create_transaction(self, fields: dict) -> dict:
        return self.post("/api/finance/transactions", fields)

    def review_transaction(self, transaction_id: str, status: str, note: str = "") -> dict:
        return self.patch(f"/api/finance/transactions/{quote(transaction_id, safe='')}/review",
                          {"status": status, "note": note})

    def delete_transaction(self, transaction_id: str) -> dict:
        return self.delete(f"/api/finance/transactions/{quote(transaction_id, safe='')}")

    def save_budgets(self, budgets: list) -> list:
        return self.put("/api/finance/budgets", {"budgets": budgets})

    # ------------------------------------------------------------ equipment
    def equipment(self, q: str = "") -> list:
        return self.get("/api/equipment", q=q)

    def create_equipment(self, fields: dict) -> dict:
        return self.post("/api/equipment", fields)

    def update_equipment(self, asset_id: str, fields: dict) -> dict:
        return self.patch(f"/api/equipment/{quote(asset_id, safe='')}", fields)

    # ---------------------------------------------------------------- forms
    def forms(self, form_type: str = "") -> list:
        return self.get("/api/forms", type=form_type)

    def form(self, form_id: str) -> dict:
        return self.get(f"/api/forms/{quote(form_id, safe='')}")

    def create_form(self, form_type: str, data: dict) -> dict:
        return self.post("/api/forms", {"type": form_type, "data": data})

    def update_form(self, form_id: str, data: dict) -> dict:
        return self.put(f"/api/forms/{quote(form_id, safe='')}", {"data": data})

    def delete_form(self, form_id: str) -> dict:
        return self.delete(f"/api/forms/{quote(form_id, safe='')}")

    def form_settings(self) -> dict:
        """Club names for printing, plus "ai": {"provider", "model"} or None when AI is not set up."""
        return self.get("/api/forms/settings")

    def save_form_settings(self, settings: dict) -> dict:
        return self.put("/api/forms/settings", settings)

    def ai_fill(self, form_type: str, text: str) -> dict:
        """AI turns a free-text description into form fields: {"fields": {...}, "notes": "..."}."""
        return self.post("/api/forms/ai-fill", {"type": form_type, "text": text}, timeout=AI_TIMEOUT)

    def ai_letter(self, text: str, doc_type: str = "函") -> dict:
        """AI rewrites plain text as an official letter: {"subject": ..., "descriptions": [...]}."""
        return self.post("/api/forms/ai-letter", {"text": text, "docType": doc_type}, timeout=AI_TIMEOUT)

    def form_print_html(self, form_id: str = "", blank_type: str = "") -> str:
        """The printable A4 page (self-contained HTML) for a saved form or a blank one."""
        path = f"/admin/forms/blank/{quote(blank_type, safe='')}" if blank_type else f"/admin/forms/print/{quote(form_id, safe='')}"
        response = self._send("GET", self._url(path))
        if response.status in (301, 302, 401):
            raise ApiError("登入已逾時，請重新登入", 401)
        if response.status >= 400:
            raise ApiError(response.text.strip()[:200] or f"伺服器錯誤（HTTP {response.status}）", response.status)
        return response.text

    # ------------------------------------------------------------ elections
    def elections(self) -> list:
        return self.get("/api/elections")

    def create_election(self, fields: dict) -> dict:
        return self.post("/api/elections", fields)

    def update_election(self, election_id: str, fields: dict) -> dict:
        return self.put(f"/api/elections/{quote(election_id, safe='')}", fields)

    def delete_election(self, election_id: str) -> dict:
        return self.delete(f"/api/elections/{quote(election_id, safe='')}")

    def election_status(self, election_id: str, action: str) -> dict:
        return self.post(f"/api/elections/{quote(election_id, safe='')}/status", {"action": action})

    def election_audit(self, election_id: str) -> dict:
        return self.get(f"/api/elections/{quote(election_id, safe='')}/audit")

    def election_results(self, election_id: str) -> dict:
        return self.get(f"/api/elections/{quote(election_id, safe='')}/results")

    def vote_page_url(self, election_id: str) -> str:
        return self._url(f"/vote/{quote(election_id, safe='')}")

    # ---------------------------------------------------------- regulations
    def regulations(self) -> list:
        return self.get("/api/regulations")

    # ---------------------------------------------------------------- users
    def users(self) -> list:
        return self.get("/api/users")

    def create_user(self, fields: dict) -> dict:
        return self.post("/api/users", fields)

    def update_user(self, fields: dict) -> dict:
        return self.patch("/api/users", fields)


def normalize_base_url(url: str) -> str:
    url = (url or "").strip().rstrip("/")
    if url and not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    return url


def session_cookie(set_cookie: str) -> str:
    match = re.search(r"(?:^|[;,\n]\s*)session=([^;,\s]+)", set_cookie or "")
    return match.group(1) if match else ""
