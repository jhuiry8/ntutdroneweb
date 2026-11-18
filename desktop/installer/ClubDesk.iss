; Inno Setup script for the classic setup wizard (ClubDesk-Setup-x.y.z.exe).
; Built by .github/workflows/desktop.yml:  iscc /DAppVersion=1.1.0 installer\ClubDesk.iss
; Installs per user (no administrator prompt), so automatic updates install quietly.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppName "北科無人機社 社務管理系統"

[Setup]
AppId={{6E1B7C52-3F0A-4C9E-9B8D-2D7A41C0D5E3}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=國立臺北科技大學無人機社
AppPublisherURL=https://github.com/jhuiry8/ntutdroneweb
DefaultDirName={autopf}\NTUT Drone Club\ClubDesk
DefaultGroupName=北科無人機社
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=ClubDesk-Setup-{#AppVersion}
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
MinVersion=10.0

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

[Run]
Filename: "{app}\ClubDesk.exe"; Description: "立即執行 {#AppName}"; Flags: nowait postinstall skipifsilent
