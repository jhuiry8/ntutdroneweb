"""Only one copy of the program runs: a second start asks the first to show its window."""

from __future__ import annotations

from PySide6.QtCore import QObject
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


class InstanceServer(QObject):
    """Listens for later starts; `handler` is called (once set) for each of them."""

    def __init__(self, name: str = SERVER_NAME, parent=None):
        super().__init__(parent)
        self.handler = None
        self.pending = False
        self.already_running = False  # another copy owns the name: the caller should exit
        self.server = QLocalServer(self)
        self.listening = False
        # Ask first: on Windows several servers may listen on the same pipe name, so a failed
        # listen() cannot be relied on to detect a running copy (it only fails on Unix).
        if ask_running_instance(name):
            self.already_running = True  # the running copy has just been asked to show itself
        else:
            self.listening = self.server.listen(name)
            if not self.listening:
                # Nobody answered, so this is a stale socket left by a crashed copy (Unix): take it over.
                QLocalServer.removeServer(name)
                self.listening = self.server.listen(name)
        self.server.newConnection.connect(self._connection)

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
