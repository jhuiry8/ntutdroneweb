# PyInstaller build recipe:  pyinstaller --noconfirm ClubDesk.spec
#
# Produces dist/ClubDesk/ (a folder, packed by installer/ClubDesk.iss into one setup
# program). Only the Qt pieces the program uses are kept: QtCore, QtGui, QtWidgets
# and QtSvg, the Windows platform plugin, the SVG/ICO image plugins and the
# Traditional Chinese translation for standard dialog buttons. Everything else
# (QML, Quick, PDF, networking, the 20 MB software OpenGL renderer...) is left out
# so the installer stays around the size of a 2010-era program (about 15-18 MB).
import re
import sys

sys.path.insert(0, SPECPATH)
from clubdesk import __version__  # noqa: E402

VERSION_INFO = None  # the Windows "Details" tab of ClubDesk.exe; needs pefile, which exists only on Windows
if sys.platform == "win32":
    from PyInstaller.utils.win32.versioninfo import (FixedFileInfo, StringFileInfo, StringStruct,  # noqa: E402
                                                     StringTable, VarFileInfo, VarStruct, VSVersionInfo)

    _v = tuple(int(x) for x in __version__.split(".")) + (0,)
    VERSION_INFO = VSVersionInfo(
        ffi=FixedFileInfo(filevers=_v, prodvers=_v),
        kids=[
            StringFileInfo([StringTable("040404B0", [
                StringStruct("CompanyName", "國立臺北科技大學無人機社"),
                StringStruct("FileDescription", "北科無人機社 社務管理系統"),
                StringStruct("FileVersion", __version__),
                StringStruct("InternalName", "ClubDesk"),
                StringStruct("LegalCopyright", "NTUT Drone Club"),
                StringStruct("OriginalFilename", "ClubDesk.exe"),
                StringStruct("ProductName", "北科無人機社 社務管理系統"),
                StringStruct("ProductVersion", __version__),
            ])]),
            VarFileInfo([VarStruct("Translation", [0x0404, 1200])]),
        ],
    )

UNUSED_MODULES = [
    "tkinter", "unittest", "pydoc", "doctest", "lib2to3", "sqlite3", "xmlrpc", "multiprocessing",
    "PySide6.QtNetwork", "PySide6.QtQml", "PySide6.QtQuick", "PySide6.QtPdf", "PySide6.QtOpenGL",
    "PySide6.QtOpenGLWidgets", "PySide6.QtDBus", "PySide6.QtPrintSupport", "PySide6.QtSql",
    "PySide6.QtTest", "PySide6.QtXml", "PySide6.QtConcurrent", "PySide6.QtSvgWidgets",
    "PySide6.QtWebEngineCore", "PySide6.QtWebEngineWidgets", "PySide6.QtWebChannel",
]

DROP = re.compile(r"""(?ix)
    (^|[/\\])(
        opengl32sw\.dll | d3dcompiler_\d+\.dll |
        (lib)?Qt6(Quick|Qml|Pdf|Network|OpenGL|VirtualKeyboard|DBus|WaylandClient|WaylandEglClientHwIntegration|
                  EglFSDeviceIntegration|XcbQpa|SvgWidgets|PrintSupport|Sql|Test|Xml|Concurrent|WebEngine|WebChannel|
                  Positioning|ShaderTools|LanguageServer|QmlModels|QmlWorkerScript)[^/\\]*
    )$
    | [/\\]plugins[/\\](platformthemes|platforminputcontexts|generic|networkinformation|tls|
                         wayland[^/\\]*|egldeviceintegrations|xcbglintegrations|qmltooling|iconengines)[/\\]
    | [/\\]plugins[/\\]imageformats[/\\](?!(lib)?q(svg|ico)\b)
    | [/\\]plugins[/\\]platforms[/\\](?!(lib)?q(windows|xcb|offscreen|cocoa)\b)
    | [/\\]translations[/\\](?!qtbase_zh_TW\.qm$)
    | [/\\]QtNetwork\.(pyd|abi3\.so)$
    | [/\\]PySide6[/\\]qml[/\\]
""")


def keep(entry) -> bool:
    name = entry[0].replace("\\", "/")
    # Qt on Linux links the platform plugin to libQt6XcbQpa, so keep it there.
    if "XcbQpa" in name and not name.lower().endswith(".dll"):
        return True
    return not DROP.search("/" + name)


a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    excludes=UNUSED_MODULES,
    noarchive=False,
    optimize=2,
)
a.binaries = [entry for entry in a.binaries if keep(entry)]
a.datas = [entry for entry in a.datas if keep(entry)]

pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ClubDesk",
    debug=False,
    strip=False,
    upx=False,
    console=False,
    icon=None,
    version=VERSION_INFO,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="ClubDesk")
