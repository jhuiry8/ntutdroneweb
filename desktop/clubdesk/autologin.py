"""Sign in at start-up with the saved 30-day session (no window, no Qt widgets)."""

from __future__ import annotations

import time

from . import saved_session
from .api import ApiClient, ApiError

EXPIRED_NOTICE = "30 天登入期限已到或登入已失效，請重新登入。"
OFFLINE_NOTICE = "目前無法連線到伺服器，無法自動登入。"
# Nothing is on screen while this runs (no window, no tray icon yet), so the whole wait is kept
# to about a minute: AUTOSTART_ATTEMPTS * ATTEMPT_TIMEOUT + (AUTOSTART_ATTEMPTS - 1) * RETRY_SECONDS.
AUTOSTART_ATTEMPTS = 7
ATTEMPT_TIMEOUT = 6
RETRY_SECONDS = 3


def auto_login(autostarted: bool, sleep=time.sleep, make_client=ApiClient):
    """Returns (client, user, notice); client is None when the person has to sign in.

    Right after Windows starts the network may not be ready yet, so an automatic
    start retries for at most about a minute. An expired or rejected session is dropped.
    """
    saved = saved_session.load()
    if not saved:
        return None, None, ""
    client = make_client(saved["server"])
    client.token = saved["token"]
    attempts = AUTOSTART_ATTEMPTS if autostarted else 1
    for attempt in range(attempts):
        try:
            return client, client.me(timeout=ATTEMPT_TIMEOUT), ""
        except ApiError as error:
            if error.status == 401:  # a 403 may come from a proxy or firewall, not from an expired session
                saved_session.clear()
                return None, None, EXPIRED_NOTICE
            if error.status != 0 and error.status < 500:
                break  # not a connection or server problem: retrying will not help
        if attempt < attempts - 1:
            sleep(RETRY_SECONDS)
    return None, None, OFFLINE_NOTICE
