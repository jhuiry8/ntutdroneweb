import os
import sys
import traceback

os.environ["QT_QPA_PLATFORM"] = "offscreen"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from PySide6.QtWidgets import QApplication

app = QApplication.instance() or QApplication([])

from clubdesk.api import ApiClient
from clubdesk.mainwindow import navigation

api = ApiClient("http://127.0.0.1:9999")
user = {"username": "admin", "role": "president"}

print("Starting page instantiation check...", flush=True)
for group, group_icon, entries in navigation(user["role"]):
    for cls, ok in entries:
        if ok:
            print(f"Instantiating {cls.__name__}...", end=" ", flush=True)
            try:
                page = cls(api, user, lambda s: None)
                print("OK", flush=True)
            except Exception as e:
                print(f"FAILED: {e}", flush=True)
                traceback.print_exc()

print("All page __init__ checks finished!", flush=True)
