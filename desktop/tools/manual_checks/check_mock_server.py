import os
import sys

DESKTOP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if DESKTOP_DIR not in sys.path:
    sys.path.insert(0, DESKTOP_DIR)

from clubdesk.api import ApiClient
from tools.manual_checks.mock_server_ui import start_mock_server

print("Starting server...", flush=True)
server, base_url = start_mock_server()
print(f"Server started at {base_url}", flush=True)

api = ApiClient(base_url)
print("Calling api.announcements()...", flush=True)
ann = api.announcements()
print("Announcements result:", ann, flush=True)

print("Calling api.posts()...", flush=True)
posts = api.posts()
print("Posts result:", posts, flush=True)

server.shutdown()
print("Server shutdown. Done!", flush=True)
os._exit(0)
