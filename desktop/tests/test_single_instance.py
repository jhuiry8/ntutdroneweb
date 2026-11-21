"""The single-instance socket: a live copy is never displaced, a stale socket is taken over."""

import os
import sys
import unittest
import uuid

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    from clubdesk import qtcompat  # noqa: F401
    from PySide6.QtCore import QCoreApplication
    from clubdesk.single_instance import InstanceServer, ask_running_instance
except ImportError as error:  # no Qt binding or its system libraries
    QCoreApplication = None
    SKIP = str(error)
else:
    SKIP = ""


@unittest.skipIf(QCoreApplication is None, f"Qt unavailable: {SKIP}")
class SingleInstanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QCoreApplication.instance() or QCoreApplication(["test"])

    def setUp(self):
        self.name = f"ClubDeskTest.{uuid.uuid4().hex}"

    def spin(self, milliseconds=300):
        from PySide6.QtCore import QEventLoop, QTimer

        loop = QEventLoop()
        QTimer.singleShot(milliseconds, loop.quit)
        loop.exec()

    def test_second_server_does_not_displace_the_running_one(self):
        first = InstanceServer(self.name)
        self.assertTrue(first.listening)
        shown = []
        first.set_handler(lambda: shown.append(1))
        second = InstanceServer(self.name)
        self.assertTrue(second.already_running)
        self.assertFalse(second.listening)
        self.spin()
        self.assertTrue(shown)  # the first copy was asked to show itself
        self.assertTrue(ask_running_instance(self.name))  # and is still reachable
        first.server.close()

    def test_free_name_is_taken(self):
        server = InstanceServer(self.name)
        self.assertTrue(server.listening)
        self.assertFalse(server.already_running)
        server.server.close()


if __name__ == "__main__":
    unittest.main()
