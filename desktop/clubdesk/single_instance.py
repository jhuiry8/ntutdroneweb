"""Only one copy of the program runs: a second start asks the first to show its window."""

from __future__ import annotations

import getpass
import hashlib
import os
import time

from PySide6.QtCore import QDir, QLockFile, QObject
from PySide6.QtNetwork import QLocalServer, QLocalSocket

SERVER_NAME = "NTUTDroneClub.ClubDesk"


def ask_running_instance(name: str = SERVER_NAME) -> bool:
    """True if another copy is running (it has been asked to show its window)."""
    socket = QLocalSocket()
    socket.connectToServer(name)
    if not socket.waitForConnected(500):
        return False
    socket.write(b"show")
    socket.waitForBytesWritten(500)
    socket.disconnectFromServer()
    return True


def lock_path(name: str = SERVER_NAME) -> str:
    """Per-user lock file in the temp folder (%TEMP% is per user on Windows; /tmp is shared on Unix)."""
    try:
        user = getpass.getuser()
    except Exception:  # noqa: BLE001 - no user name available: one lock for the machine
        user = ""
    suffix = hashlib.sha256(f"{name}|{user}".encode("utf-8")).hexdigest()[:16]
    return os.path.join(QDir.tempPath(), f"{name}.{suffix}.lock")


class InstanceServer(QObject):
    """Listens for later starts; `handler` is called (once set) for each of them.

    Ownership is decided by a lock file, not by asking first: two copies started at the same
    moment cannot both take the lock, while asking-then-listening leaves a window in which both
    find nobody and both listen (Windows even lets two servers share one pipe name).
    """

    def __init__(self, name: str = SERVER_NAME, parent=None, lock_file: str | None = None):
        super().__init__(parent)
        self.handler = None
        self.pending = False
        self.already_running = False  # another copy owns the name: the caller should exit
        self.server = QLocalServer(self)
        self.listening = False
        self.lock = QLockFile(lock_file or lock_path(name))
        # A lock left by a crashed copy is stale because its process is gone; never by age alone,
        # since the running copy holds it for days.
        self.lock.setStaleLockTime(0)
        if not self.lock.tryLock(0):
            self.already_running = True
            # The owner may still be starting up and not listening yet: ask it to show itself for a moment.
            for _ in range(10):
                if ask_running_instance(name):
                    break
                time.sleep(0.2)
        else:
            # This copy owns the name, so any server socket left behind is stale (Unix): take it over.
            QLocalServer.removeServer(name)
            self.listening = self.server.listen(name)
        self.server.newConnection.connect(self._connection)

    def release(self) -> None:
        """Stop listening and drop the lock (also happens when the process exits)."""
        self.server.close()
        self.lock.unlock()

    def _connection(self) -> None:
        while self.server.hasPendingConnections():
            self.server.nextPendingConnection().deleteLater()
        if self.handler:
            self.handler()
        else:
            self.pending = True  # a second start arrived before the window existed

    def set_handler(self, handler) -> None:
        self.handler = handler
        if self.pending:
            self.pending = False
            handler()
