import os
import sys
import time

os.environ["QT_QPA_PLATFORM"] = "offscreen"
DESKTOP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if DESKTOP_DIR not in sys.path:
    sys.path.insert(0, DESKTOP_DIR)

from PySide6.QtWidgets import QApplication

app = QApplication.instance() or QApplication([])

from clubdesk.api import ApiClient
from clubdesk.pages.messages import MessagesPage
from tools.manual_checks.mock_server_ui import start_mock_server

server, base_url = start_mock_server()
api = ApiClient(base_url)
user = {"username": "admin", "role": "president"}

print("Creating MessagesPage...", flush=True)
p = MessagesPage(api, user, lambda s: None)
p.show()
app.processEvents()

print("Calling p.refresh()...", flush=True)
p.refresh()
print("p.refresh() returned! Processing events...", flush=True)

for i in range(10):
    time.sleep(0.05)
    app.processEvents()

print("Capturing pixmap...", flush=True)
pix = p.grab()
print(f"Pixmap size: {pix.width()}x{pix.height()}", flush=True)

server.shutdown()
print("All done!", flush=True)
os._exit(0)
