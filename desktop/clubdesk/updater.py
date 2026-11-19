"""Update check: ask the website which desktop version is current, then download,
verify (SHA-256) and run the new installer.

The website's GET /api/desktop/version answers {version, url, sha256, notes, mandatory}
or {version: null}. The president publishes a release from 工具 → 發布桌面版更新,
usually after the GitHub Actions workflow has built the installer as a GitHub Release.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.request

from PySide6.QtCore import QProcess, Qt, QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (QApplication, QCheckBox, QDialog, QFormLayout, QLabel, QLineEdit,
                               QMessageBox, QPlainTextEdit, QProgressDialog, QPushButton, QVBoxLayout)

from . import WIN7_EDITION, __version__
from .api import USER_AGENT, ApiClient, ApiError, ssl_context
from .widgets import busy, show_error

GITHUB_REPO = "jhuiry8/ntutdroneweb"
RELEASE_TAG_PREFIX = "desktop-v"


def parse_version(text: str) -> tuple[int, ...]:
    match = re.fullmatch(r"\s*v?(\d+)\.(\d+)\.(\d+)\s*", str(text or ""))
    return tuple(int(part) for part in match.groups()) if match else ()


def is_newer(latest: str, current: str = __version__) -> bool:
    latest_parts, current_parts = parse_version(latest), parse_version(current)
    return bool(latest_parts) and (not current_parts or latest_parts > current_parts)


def latest_release(api: ApiClient) -> dict | None:
    """The published release if it is newer than this program, else None."""
    release = api.request("GET", "/api/desktop/version")
    if isinstance(release, dict) and is_newer(release.get("version") or ""):
        return release
    return None


def download(url: str, sha256: str, parent) -> str | None:
    """Downloads with a progress dialog; returns the file path, or None if cancelled."""
    if not url.startswith("https://"):
        raise ApiError("下載網址必須使用 https")
    name = os.path.basename(urllib.request.urlparse(url).path) or "ClubDesk-Setup.exe"
    folder = os.path.join(tempfile.gettempdir(), "ClubDesk-update")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, name)
    progress = QProgressDialog("正在下載新版本...", "取消", 0, 100, parent)
    progress.setWindowTitle("下載更新")
    progress.setWindowModality(Qt.WindowModal)
    progress.setMinimumDuration(0)
    digest = hashlib.sha256()
    try:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=30, context=ssl_context()) as response, open(path, "wb") as handle:
            total = int(response.headers.get("Content-Length") or 0)
            done = 0
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
                digest.update(chunk)
                done += len(chunk)
                progress.setValue(int(done * 100 / total) if total else 0)
                progress.setLabelText(f"正在下載新版本...　{done // 1024:,} KB" + (f" / {total // 1024:,} KB" if total else ""))
                QApplication.processEvents()
                if progress.wasCanceled():
                    break
    except OSError as error:
        raise ApiError(f"下載失敗：{error}") from error
    finally:
        progress.close()
    if progress.wasCanceled():
        os.remove(path)
        return None
    if digest.hexdigest() != sha256.lower():
        os.remove(path)
        raise ApiError("下載的檔案與發布的 SHA-256 不符，已刪除。請稍後再試或洽社長。")
    return path


def offer_update(parent, release: dict) -> bool:
    """Asks the user; returns True if the program should quit so the installer can run."""
    mandatory = release.get("mandatory") is True
    notes = (release.get("notes") or "").strip()
    text = f"發現新版本 {release['version']}（目前使用 {__version__}）。"
    if notes:
        text += f"\n\n更新內容：\n{notes}"
    text += "\n\n是否立即下載並安裝？" if not mandatory else "\n\n此版本為必要更新，需安裝後才能繼續使用。"
    box = QMessageBox(QMessageBox.Information, "軟體更新", text, parent=parent)
    install = box.addButton("立即更新(&U)", QMessageBox.AcceptRole)
    box.addButton("結束程式" if mandatory else "稍後再說(&L)", QMessageBox.RejectRole)
    box.exec()
    if box.clickedButton() is not install:
        if mandatory:
            QApplication.quit()
            return True
        return False
    if not getattr(sys, "frozen", False):  # running from source: just show the download
        QDesktopServices.openUrl(QUrl(release["url"]))
        return False
    try:
        path = download(release["url"], release.get("sha256", ""), parent)
    except ApiError as error:
        show_error(parent, error, "軟體更新")
        return False
    if not path:
        return False
    if not QProcess.startDetached(path, []):
        show_error(parent, ApiError(f"無法啟動安裝程式，請手動執行：\n{path}"), "軟體更新")
        return False
    QApplication.quit()
    return True


def check_and_offer(parent, api: ApiClient, quiet: bool = True) -> bool:
    if WIN7_EDITION:
        # The Windows 7 edition is a separate frozen build: the website's update channel belongs
        # to the normal edition, so offering its installer here would replace this edition.
        if not quiet:
            QMessageBox.information(parent, "檢查更新", "Windows 7 版不提供自動更新。\n"
                                    "需要時請到 GitHub Releases 下載最新的 ClubDesk-Win7-Setup。")
        return False
    try:
        with busy():
            release = latest_release(api)
    except ApiError as error:
        if not quiet:
            show_error(parent, error, "檢查更新")
        return False
    if not release:
        if not quiet:
            QMessageBox.information(parent, "檢查更新", f"目前使用的 {__version__} 已是最新版本。")
        return False
    return offer_update(parent, release)


def github_latest_release() -> dict:
    """Reads the newest desktop-v* GitHub Release: version, installer URL and SHA-256."""
    request = urllib.request.Request(f"https://api.github.com/repos/{GITHUB_REPO}/releases?per_page=20",
                                     headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(request, timeout=20, context=ssl_context()) as response:
            releases = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError) as error:
        raise ApiError(f"無法讀取 GitHub Release：{error}") from error
    for release in releases:
        tag = release.get("tag_name", "")
        if not tag.startswith(RELEASE_TAG_PREFIX) or release.get("draft"):
            continue
        # The release also holds the Windows 7 installer and the Android APK: take only this edition's installer.
        asset = next((a for a in release.get("assets", []) if re.fullmatch(r"ClubDesk-Setup-.*\.exe", a.get("name", ""), re.I)), None)
        if not asset:   # older releases: any single installer
            asset = next((a for a in release.get("assets", [])
                          if a.get("name", "").lower().endswith(".exe") and "win7" not in a.get("name", "").lower()), None)
        if not asset:
            continue
        sha = (asset.get("digest") or "")
        if sha.startswith("sha256:"):
            sha = sha[len("sha256:"):]
        if not re.fullmatch(r"[0-9a-f]{64}", sha):
            found = re.search(r"SHA-?256[^0-9a-fA-F]*([0-9a-fA-F]{64})", release.get("body") or "")
            sha = found.group(1).lower() if found else ""
        return {"version": tag[len(RELEASE_TAG_PREFIX):], "url": asset.get("browser_download_url", ""),
                "sha256": sha, "notes": (release.get("body") or "").split("###")[0].split("SHA")[0].strip()[:2000]}
    raise ApiError(f"GitHub 上找不到 {RELEASE_TAG_PREFIX}* 的 Release 安裝檔")


class PublishDialog(QDialog):
    """社長: tell every desktop program which version to install."""

    def __init__(self, parent, api: ApiClient):
        super().__init__(parent)
        self.api = api
        self.setWindowTitle("發布桌面版更新")
        self.version = QLineEdit()
        self.version.setPlaceholderText("例如 1.2.0")
        self.url = QLineEdit()
        self.url.setPlaceholderText("https://github.com/.../releases/download/.../ClubDesk-Setup-1.2.0.exe")
        self.sha256 = QLineEdit()
        self.notes = QPlainTextEdit()
        self.notes.setFixedHeight(90)
        self.mandatory = QCheckBox("必要更新（不更新就無法使用）")
        fetch = QPushButton("從 GitHub 最新 Release 帶入(&G)")
        fetch.clicked.connect(self.fill_from_github)
        try:
            current = api.request("GET", "/api/desktop/version")
        except ApiError:
            current = {}
        if current.get("version"):
            self.version.setText(current["version"])
            self.url.setText(current.get("url", ""))
            self.sha256.setText(current.get("sha256", ""))
            self.notes.setPlainText(current.get("notes", ""))
            self.mandatory.setChecked(current.get("mandatory") is True)
        form = QFormLayout()
        form.addRow("版本號：", self.version)
        form.addRow("安裝檔網址：", self.url)
        form.addRow("SHA-256：", self.sha256)
        form.addRow("更新說明：", self.notes)
        form.addRow("", self.mandatory)
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel(f"目前已發布：{current.get('version') or '（尚未發布）'}　本機版本：{__version__}"))
        layout.addWidget(fetch)
        layout.addLayout(form)
        layout.addWidget(QLabel("發布後，所有社員開啟桌面程式時都會收到更新通知。"))
        from .pages.members import dialog_buttons  # local import avoids a cycle
        layout.addWidget(dialog_buttons(self))
        self.setMinimumWidth(520)

    def fill_from_github(self) -> None:
        try:
            with busy():
                release = github_latest_release()
        except ApiError as error:
            show_error(self, error)
            return
        self.version.setText(release["version"])
        self.url.setText(release["url"])
        self.sha256.setText(release["sha256"])
        self.notes.setPlainText(release["notes"])

    def accept(self) -> None:
        body = {"version": self.version.text().strip(), "url": self.url.text().strip(),
                "sha256": self.sha256.text().strip(), "notes": self.notes.toPlainText().strip(),
                "mandatory": self.mandatory.isChecked()}
        try:
            with busy():
                self.api.put("/api/desktop/version", body)
        except ApiError as error:
            show_error(self, error)
            return
        QMessageBox.information(self, "發布桌面版更新", f"已發布 {body['version']}。")
        super().accept()
