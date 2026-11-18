"""Client for the club website's back end (Cloudflare Workers, src/worker.js).

The desktop program uses the same /api/* routes as the web dashboard. Login
goes through the same form as the website: the server's image CAPTCHA is
fetched from /api/captcha and the answer is posted to /api/login together
with the user name and password. On success the server answers with a 302
redirect and a `session` cookie, which is then sent with every later call.
"""

from __future__ import annotations

import re
from html import unescape
from urllib.parse import quote, urljoin

import requests

TIMEOUT = 20
USER_AGENT = "NTUTDroneClubDesk/1.0"

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


class ApiError(Exception):
    """An error reported by the server, or a connection failure."""

    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


_LOGIN_ERROR = re.compile(r'alert-circle"[^>]*></i>\s*(.*?)\s*</div>', re.S)


class ApiClient:
    def __init__(self, base_url: str, session: requests.Session | None = None):
        self.base_url = normalize_base_url(base_url)
        self.http = session or requests.Session()
        self.http.headers["User-Agent"] = USER_AGENT
        self.token = ""

    # ------------------------------------------------------------ transport
    def _url(self, path: str) -> str:
        return urljoin(self.base_url + "/", path.lstrip("/"))

    def _headers(self) -> dict:
        # The session cookie is marked Secure, so a cookie jar would drop it on
        # plain-http test servers (wrangler dev). Send it by hand instead.
        return {"Cookie": f"session={self.token}"} if self.token else {}

    def request(self, method: str, path: str, *, params=None, json=None):
        try:
            response = self.http.request(
                method, self._url(path), params=params, json=json,
                headers=self._headers(), timeout=TIMEOUT, allow_redirects=False,
            )
        except requests.RequestException as error:
            raise ApiError(f"無法連線到伺服器：{error}") from error
        try:
            body = response.json()
        except ValueError:
            body = None
        if response.status_code >= 400:
            message = body.get("error") if isinstance(body, dict) else None
            if response.status_code == 401:
                message = message or "登入已逾時，請重新登入"
            raise ApiError(message or f"伺服器錯誤（HTTP {response.status_code}）", response.status_code)
        if body is None:
            raise ApiError("伺服器回應格式錯誤", response.status_code)
        return body

    def get(self, path, **params):
        return self.request("GET", path, params={k: v for k, v in params.items() if v})

    def post(self, path, data=None):
        return self.request("POST", path, json=data or {})

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
        data = {"username": username, "password": password,
                "captcha_id": captcha_id, "captcha": captcha_answer}
        try:
            response = self.http.post(self._url("/api/login"), data=data, timeout=TIMEOUT,
                                      allow_redirects=False)
        except requests.RequestException as error:
            raise ApiError(f"無法連線到伺服器：{error}") from error
        token = session_cookie(response)
        if response.status_code == 302 and token:
            self.token = token
            return self.me()
        match = _LOGIN_ERROR.search(response.text or "")
        message = unescape(re.sub(r"<[^>]+>", "", match.group(1))).strip() if match else ""
        raise ApiError(message or f"登入失敗（HTTP {response.status_code}）", response.status_code)

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


def session_cookie(response: requests.Response) -> str:
    header = response.headers.get("Set-Cookie", "")
    match = re.search(r"(?:^|[;,]\s*)session=([^;,\s]+)", header)
    return match.group(1) if match else ""
