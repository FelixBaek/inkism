; Validation builds use a separate URL scheme and never register over installed Inkism.
#ifdef ValidationBuild
#define NoteProtocol "inkism-validation-note"
#else
#define NoteProtocol "note"
#endif
[Setup]
#ifdef ValidationBuild
AppId=Inkism-Isolated-Validation
Uninstallable=yes
CreateUninstallRegKey=no
UsePreviousAppDir=no
DisableProgramGroupPage=yes
CloseApplications=no
#else
AppId={{D419A536-8962-4FC0-9109-906B5964808E}
CloseApplications=yes
#endif
AppName=inkism
AppVersion=0.1.0
AppPublisher=Felix
DefaultDirName={localappdata}\Programs\Inkism
DefaultGroupName=inkism
PrivilegesRequired=lowest
ChangesAssociations=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\..\..\dist
#ifdef ValidationBuild
OutputBaseFilename=Inkism-validation-setup
#else
OutputBaseFilename=Inkism-setup
#endif
Compression=lzma2
SolidCompression=yes
UninstallDisplayIcon={app}\Inkism.exe

[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; Flags: unchecked
Name: notelinks; Description: "Open note:// links with Inkism"; Flags: unchecked

[Files]
Source: "..\..\..\dist\windows\Inkism.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\..\dist\windows\inkism-engine.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\..\dist\windows\WebView2Loader.dll"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\..\..\dist\windows\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\..\dist\windows\BUILD.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\scripts\ensure-webview2.ps1"; Flags: dontcopy

#ifndef ValidationBuild
[Icons]
Name: "{group}\inkism"; Filename: "{app}\Inkism.exe"
Name: "{autodesktop}\inkism"; Filename: "{app}\Inkism.exe"; Tasks: desktopicon

#endif

[Registry]
; This optional task changes only the current user's selected note-link handler.
; Cleanup is conditional in CurUninstallStepChanged; another later handler survives.
Root: HKCU; Subkey: "Software\Classes\{#NoteProtocol}"; ValueType: string; ValueName: ""; ValueData: "URL:Inkism Note"; Tasks: notelinks
Root: HKCU; Subkey: "Software\Classes\{#NoteProtocol}"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""; Tasks: notelinks
Root: HKCU; Subkey: "Software\Classes\{#NoteProtocol}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\Inkism.exe"",0"; Tasks: notelinks
Root: HKCU; Subkey: "Software\Classes\{#NoteProtocol}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Inkism.exe"" --open ""%1"""; Tasks: notelinks

[Run]
Filename: "{app}\Inkism.exe"; Description: "Open inkism"; Flags: nowait postinstall skipifsilent

#ifndef ValidationBuild
[UninstallRun]
Filename: "{app}\Inkism.exe"; Parameters: "--remove-reminder-tasks"; Flags: runhidden; RunOnceId: "InkismReminderTasks"
#endif

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Result := '';
  ExtractTemporaryFile('ensure-webview2.ps1');
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\ensure-webview2.ps1') + '"',
    '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Result := 'Unable to check Microsoft WebView2. Install WebView2 and retry.';
  if (Result = '') and (Code <> 0) then
    Result := 'Microsoft WebView2 installation failed. Check your internet connection and retry.';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  RegisteredCommand: String;
begin
  if CurUninstallStep = usUninstall then
    if RegQueryStringValue(HKCU, 'Software\Classes\{#NoteProtocol}\shell\open\command', '', RegisteredCommand) then
      if CompareText(RegisteredCommand, ExpandConstant('"{app}\Inkism.exe" --open "%1"')) = 0 then
        RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Classes\{#NoteProtocol}');
end;
