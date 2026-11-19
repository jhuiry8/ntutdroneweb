import os
import sys
import time

os.environ["QT_QPA_PLATFORM"] = "offscreen"
DESKTOP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if DESKTOP_DIR not in sys.path:
    sys.path.insert(0, DESKTOP_DIR)

from PySide6.QtCore import QSettings
from PySide6.QtWidgets import QApplication

from clubdesk import __version__

QSettings().setValue("welcome/version", __version__)

from PySide6.QtWidgets import QApplication, QSystemTrayIcon
QSystemTrayIcon.isSystemTrayAvailable = staticmethod(lambda: False)
app = QApplication.instance() or QApplication([])

from clubdesk.api import ApiClient
from clubdesk.mainwindow import MainWindow
MainWindow.check_messages = lambda self: None
from tools.manual_checks.mock_server_ui import start_mock_server

print("1. Starting mock server...", flush=True)
server, base_url = start_mock_server()
api = ApiClient(base_url)
user = {"username": "admin", "role": "president"}

print("2. Instantiating MainWindow...", flush=True)
win = MainWindow(api, user)
win.poll.stop()
win.tray = None

print("3. Showing MainWindow...", flush=True)
win.show()
app.processEvents()

print(f"4. Testing pages (total {len(win.pages)})...", flush=True)
for idx, page in enumerate(win.pages):
    print(f"   [{idx + 1:02d}/{len(win.pages):02d}] Showing {page.__class__.__name__}...", flush=True)
    win.show_page(idx)
    app.processEvents()
    for _ in range(5):
        time.sleep(0.02)
        app.processEvents()
    pix = win.grab()
    print(f"       Captured {pix.width()}x{pix.height()}", flush=True)

print("5. All pages tested successfully!", flush=True)
server.shutdown()
print("Done! Exiting cleanly with os._exit(0)", flush=True)
os._exit(0)
