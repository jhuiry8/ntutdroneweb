; Inno Setup script for the classic setup wizard (ClubDesk-Setup-x.y.z.exe).
; Built by .github/workflows/desktop.yml:  iscc /DAppVersion=1.1.0 installer\ClubDesk.iss
; Installs per user (no administrator prompt), so automatic updates install quietly.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifdef Win7
  ; Separate Windows 7 edition:  iscc /DWin7 /DAppVersion=1.2.0 installer\ClubDesk.iss
  #define AppName "北科無人機社 社務管理系統 (Windows 7 版)"
  #define OutName "ClubDesk-Win7-Setup"
#else
  #define AppName "北科無人機社 社務管理系統"
  #define OutName "ClubDesk-Setup"
#endif

[Setup]
#ifdef Win7
AppId={{A3C54D0E-7B21-4E5F-8C19-5D6F0B7E92A4}
DefaultDirName={autopf}\NTUT Drone Club\ClubDesk-Win7
#else
AppId={{6E1B7C52-3F0A-4C9E-9B8D-2D7A41C0D5E3}
DefaultDirName={autopf}\NTUT Drone Club\ClubDesk
#endif
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=國立臺北科技大學無人機社
AppPublisherURL=https://github.com/jhuiry8/ntutdroneweb
DefaultGroupName=北科無人機社
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename={#OutName}-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=classic
DisableWelcomePage=no
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\ClubDesk.exe
SetupIconFile=..\clubdesk\resources\app.ico
UninstallDisplayName={#AppName}
VersionInfoVersion={#AppVersion}
VersionInfoDescription={#AppName} 安裝程式
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#ifdef Win7
MinVersion=6.1sp1
#else
MinVersion=10.0
#endif

[Languages]
Name: "cht"; MessagesFile: "ChineseTraditional.isl"

[Tasks]
Name: "desktopicon"; Description: "建立桌面捷徑(&D)"; GroupDescription: "其他工作："

[Files]
Source: "..\dist\ClubDesk\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; Remove files of the previous version so old Qt libraries do not linger.
Type: filesandordirs; Name: "{app}\_internal"

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\ClubDesk.exe"
Name: "{group}\解除安裝 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\ClubDesk.exe"; Tasks: desktopicon

[Registry]
; The program adds this itself (start with Windows); remove it on uninstall.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "ClubDesk"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\ClubDesk.exe"; Description: "立即執行 {#AppName}"; Flags: nowait postinstall skipifsilent
