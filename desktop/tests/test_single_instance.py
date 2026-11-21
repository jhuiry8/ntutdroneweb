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
        second.release()
        first.release()

    def test_free_name_is_taken(self):
        server = InstanceServer(self.name)
        self.assertTrue(server.listening)
        self.assertFalse(server.already_running)
        server.release()
        # Released: the next start takes over.
        again = InstanceServer(self.name)
        self.assertTrue(again.listening)
        again.release()

    def test_a_copy_still_starting_up_is_not_displaced(self):
        from PySide6.QtCore import QLockFile

        from clubdesk.single_instance import lock_path

        # Another copy holds the lock but is not listening yet (it is still starting).
        held = QLockFile(lock_path(self.name))
        self.assertTrue(held.tryLock(0))
        second = InstanceServer(self.name)
        self.assertTrue(second.already_running)
        self.assertFalse(second.listening)  # it must not start listening in the other copy's place
        held.unlock()

    def test_a_lock_left_by_a_crashed_copy_is_taken_over(self):
        import os
        import socket

        from PySide6.QtCore import QSysInfo

        from clubdesk.single_instance import lock_path

        path = lock_path(self.name)
        # QLockFile's format: pid, application name, host name. PID 2**22 + 12345 is not a running process.
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(f"{2 ** 22 + 12345}\nClubDesk\n{QSysInfo.machineHostName() or socket.gethostname()}\n")
        try:
            server = InstanceServer(self.name)
            self.assertTrue(server.listening)
            self.assertFalse(server.already_running)
            server.release()
        finally:
            if os.path.exists(path):
                os.remove(path)


if __name__ == "__main__":
    unittest.main()
