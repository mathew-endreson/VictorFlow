; VictorFlow Server — the Windows installer for the shop's server computer (Inno Setup 6.7).
;
; Built by .github/workflows/server-build.yml:
;   node apps/server-host/scripts/stage.mjs --out <stage>
;   ISCC /DAppVersion=<x.y.z> /DStageDir=<stage> /DOutputDir=<dist> apps\server-host\installer\victorflow-server.iss
;
; It copies the program files, installs the Microsoft Visual C++ runtime PostgreSQL needs, then runs "vf-server setup",
; which creates the data folder, the database and the Windows services and opens the firewall to the LAN. Running it
; again upgrades in place (the services are stopped first, the data folder is kept). Uninstalling removes the services
; and the program files and keeps the data folder.
;
; Saved as UTF-8 with a byte-order mark: Inno Setup needs it to read the French and Arabic messages below.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef StageDir
  #define StageDir "..\.stage"
#endif
#ifndef OutputDir
  #define OutputDir "..\.dist"
#endif
#define AppGuid "8B3F2D6A-4C1E-4E7B-9A55-2D7C6B1F0E93"
; "{{" is a literal "{" in [Setup]; the registry key the uninstaller is listed under has single braces.
#define AppIdSetting "{{" + AppGuid + "}"
#define UninstallKeyName "{" + AppGuid + "}_is1"

[Setup]
AppId={#AppIdSetting}
AppName=VictorFlow Server
AppVersion={#AppVersion}
AppVerName=VictorFlow Server {#AppVersion}
AppPublisher=BluxTech
VersionInfoVersion={#AppVersion}
DefaultDirName={autopf}\VictorFlow Server
UsePreviousAppDir=yes
DefaultGroupName=VictorFlow Server
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputDir}
OutputBaseFilename=VictorFlow-Server-Setup-{#AppVersion}
SetupIconFile={#StageDir}\app\victorflow.ico
UninstallDisplayIcon={app}\victorflow.ico
UninstallDisplayName=VictorFlow Server
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
SetupLogging=yes
ShowLanguageDialog=auto

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"
Name: "ar"; MessagesFile: "compiler:Languages\Arabic.isl"

[CustomMessages]
en.DataDirCaption=Data folder
en.DataDirDescription=Where VictorFlow Server keeps its database, files, secrets and logs.
en.DataDirSubCaption=Everything VictorFlow stores goes into this one folder, and it is kept if VictorFlow Server is uninstalled. Choose a folder on a local disk with plenty of free space.
en.DataDirInvalid=Choose a folder on a local disk (for example C:\ProgramData\VictorFlow), outside the program folder, whose path uses only plain letters without accents.
en.InstallingRuntime=Installing the Microsoft Visual C++ runtime…
en.RuntimeFailed=The Microsoft Visual C++ runtime could not be installed (code %1). PostgreSQL needs it. Install "vc_redist.x64.exe" from Microsoft, then run this installer again.
en.SettingUp=Creating the database and starting the VictorFlow services. This can take a minute…
en.SetupFailed=VictorFlow Server could not finish setting up (code %1).%n%nThe reason is in:%n%2%n%nFix it, then run this installer again.
en.StopFailed=The VictorFlow services running on this computer could not be stopped (code %1). Stop them in Services (services.msc), then run this installer again.
en.NewerInstalled=VictorFlow Server %1 is already installed. Installing the older version %2 over it is not supported.
en.FinishedSummary=VictorFlow Server is running.%n%nOn each company PC, install the VictorFlow desktop app and enter this server address on its sign-in screen (Server → Change):%n%n      %1%n%nTracking website: %2%nTV screens: %3%n%nFirst sign-in: admin@victorflow.local — the password is in:%n%4
en.PublicNetwork=Warning: this computer's network is set to "Public", so Windows blocks the other PCs. Set it to Private: Settings → Network & internet → your network.
en.DataKept=VictorFlow Server was removed. Its data (database, files, secrets) was kept in:%n%1
en.StatusShortcut=VictorFlow Server status
en.DataShortcut=VictorFlow Server data folder

fr.DataDirCaption=Dossier des données
fr.DataDirDescription=L'emplacement de la base de données, des fichiers, des secrets et des journaux de VictorFlow Server.
fr.DataDirSubCaption=Tout ce que VictorFlow enregistre va dans ce seul dossier, qui est conservé si VictorFlow Server est désinstallé. Choisissez un dossier sur un disque local avec beaucoup d'espace libre.
fr.DataDirInvalid=Choisissez un dossier sur un disque local (par exemple C:\ProgramData\VictorFlow), hors du dossier du programme, dont le chemin n'utilise que des lettres simples, sans accents.
fr.InstallingRuntime=Installation du runtime Microsoft Visual C++…
fr.RuntimeFailed=Le runtime Microsoft Visual C++ n'a pas pu être installé (code %1). PostgreSQL en a besoin. Installez « vc_redist.x64.exe » depuis le site de Microsoft, puis relancez ce programme d'installation.
fr.SettingUp=Création de la base de données et démarrage des services VictorFlow. Cela peut prendre une minute…
fr.SetupFailed=VictorFlow Server n'a pas pu terminer sa configuration (code %1).%n%nLa raison se trouve dans :%n%2%n%nCorrigez le problème, puis relancez ce programme d'installation.
fr.StopFailed=Les services VictorFlow en cours sur cet ordinateur n'ont pas pu être arrêtés (code %1). Arrêtez-les dans Services (services.msc), puis relancez ce programme d'installation.
fr.NewerInstalled=VictorFlow Server %1 est déjà installé. Installer par-dessus l'ancienne version %2 n'est pas possible.
fr.FinishedSummary=VictorFlow Server fonctionne.%n%nSur chaque ordinateur de l'entreprise, installez l'application VictorFlow et saisissez cette adresse de serveur sur l'écran de connexion (Serveur → Modifier) :%n%n      %1%n%nSite de suivi : %2%nÉcrans TV : %3%n%nPremière connexion : admin@victorflow.local — le mot de passe se trouve dans :%n%4
fr.PublicNetwork=Attention : le réseau de cet ordinateur est « Public », Windows bloque donc les autres ordinateurs. Passez-le en Privé : Paramètres → Réseau et Internet → votre réseau.
fr.DataKept=VictorFlow Server a été supprimé. Ses données (base de données, fichiers, secrets) ont été conservées dans :%n%1
fr.StatusShortcut=État de VictorFlow Server
fr.DataShortcut=Dossier des données de VictorFlow Server

ar.DataDirCaption=مجلد البيانات
ar.DataDirDescription=المكان الذي يحفظ فيه VictorFlow Server قاعدة بياناته وملفاته وأسراره وسجلاته.
ar.DataDirSubCaption=كل ما يحفظه VictorFlow يوضع في هذا المجلد الواحد، ويُحتفظ به إذا أُزيل VictorFlow Server. اختر مجلداً على قرص محلي فيه مساحة فارغة كافية.
ar.DataDirInvalid=اختر مجلداً على قرص محلي (مثلاً C:\ProgramData\VictorFlow)، خارج مجلد البرنامج، ولا يحتوي مساره إلا على حروف لاتينية بسيطة دون علامات.
ar.InstallingRuntime=جارٍ تثبيت مكتبة Microsoft Visual C++…
ar.RuntimeFailed=تعذّر تثبيت مكتبة Microsoft Visual C++ (الرمز %1). يحتاجها PostgreSQL. ثبّت "vc_redist.x64.exe" من موقع Microsoft، ثم أعد تشغيل برنامج التثبيت هذا.
ar.SettingUp=جارٍ إنشاء قاعدة البيانات وتشغيل خدمات VictorFlow. قد يستغرق ذلك دقيقة…
ar.SetupFailed=تعذّر على VictorFlow Server إتمام الإعداد (الرمز %1).%n%nالسبب مذكور في:%n%2%n%nأصلح المشكلة، ثم أعد تشغيل برنامج التثبيت هذا.
ar.StopFailed=تعذّر إيقاف خدمات VictorFlow العاملة على هذا الحاسوب (الرمز %1). أوقفها من نافذة الخدمات (services.msc)، ثم أعد تشغيل برنامج التثبيت هذا.
ar.NewerInstalled=الإصدار %1 من VictorFlow Server مثبّت مسبقاً. لا يمكن تثبيت الإصدار الأقدم %2 فوقه.
ar.FinishedSummary=VictorFlow Server يعمل.%n%nعلى كل حاسوب في المؤسسة، ثبّت تطبيق VictorFlow وأدخل عنوان الخادم هذا في شاشة تسجيل الدخول (الخادم ← تغيير):%n%n      %1%n%nموقع تتبع الطلبات: %2%nشاشات التلفاز: %3%n%nأول تسجيل دخول: admin@victorflow.local — كلمة المرور موجودة في:%n%4
ar.PublicNetwork=تنبيه: شبكة هذا الحاسوب مضبوطة على "عامة"، لذا يحجب Windows الحواسيب الأخرى. اجعلها "خاصة": الإعدادات ← الشبكة والإنترنت ← شبكتك.
ar.DataKept=أُزيل VictorFlow Server. احتُفظ ببياناته (قاعدة البيانات والملفات والأسرار) في:%n%1
ar.StatusShortcut=حالة VictorFlow Server
ar.DataShortcut=مجلد بيانات VictorFlow Server

[InstallDelete]
; An upgrade replaces the program parts whole, so no file of an older version lingers.
Type: filesandordirs; Name: "{app}\node"
Type: filesandordirs; Name: "{app}\pg"
Type: filesandordirs; Name: "{app}\server"
Type: filesandordirs; Name: "{app}\tracker"
Type: filesandordirs; Name: "{app}\display"
Type: filesandordirs; Name: "{app}\migrations"
Type: filesandordirs; Name: "{app}\services"

[Files]
Source: "{#StageDir}\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\redist\vc_redist.x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Dirs]
; Next.js may write a cache beside each web app; the services run as NetworkService.
Name: "{app}\tracker\apps\tracker\.next\cache"; Permissions: networkservice-modify
Name: "{app}\display\apps\display\.next\cache"; Permissions: networkservice-modify

[Icons]
Name: "{group}\{cm:StatusShortcut}"; Filename: "{cmd}"; Parameters: "/k ""{app}\vf-server.cmd"" status"; WorkingDir: "{app}"; IconFilename: "{app}\victorflow.ico"
Name: "{group}\{cm:DataShortcut}"; Filename: "{code:GetDataDir}"

[UninstallRun]
Filename: "{app}\node\node.exe"; Parameters: """{app}\vf-server.mjs"" remove"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveServices"

[UninstallDelete]
Type: files; Name: "{app}\install.json"
Type: filesandordirs; Name: "{app}\services"
Type: filesandordirs; Name: "{app}\tracker"
Type: filesandordirs; Name: "{app}\display"

[Code]
var
  DataDirPage: TInputDirWizardPage;
  SetupExitCode: Integer;
  Summary: String;
  DataDirAtUninstall: String;

const
  UninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#UninstallKeyName}';

function PreviousDataDir(): String;
begin
  Result := GetPreviousData('DataDir', '');
end;

function GetDataDir(Param: String): String;
begin
  Result := RemoveBackslashUnlessRoot(DataDirPage.Values[0]);
end;

{ A local, absolute, plain-ASCII path outside the program folder (vf-server setup checks the same, for silent installs). }
function IsUsableDataDir(Dir: String): Boolean;
var
  I: Integer;
begin
  Result := (Length(Dir) >= 3) and (Copy(Dir, 2, 2) = ':\');
  if not Result then Exit;
  for I := 1 to Length(Dir) do
    if (Ord(Dir[I]) < 32) or (Ord(Dir[I]) > 126) then
    begin
      Result := False;
      Exit;
    end;
  if Pos(Uppercase(AddBackslash(ExpandConstant('{app}'))), Uppercase(AddBackslash(Dir))) = 1 then Result := False;
end;

function NextVersionPart(var S: String): Integer;
var
  P: Integer;
begin
  P := Pos('.', S);
  if P = 0 then
  begin
    Result := StrToIntDef(S, 0);
    S := '';
  end
  else
  begin
    Result := StrToIntDef(Copy(S, 1, P - 1), 0);
    Delete(S, 1, P);
  end;
end;

function CompareVersions(A, B: String): Integer;
var
  I, X, Y: Integer;
begin
  Result := 0;
  for I := 1 to 4 do
  begin
    X := NextVersionPart(A);
    Y := NextVersionPart(B);
    if X <> Y then
    begin
      if X > Y then Result := 1 else Result := -1;
      Exit;
    end;
  end;
end;

function InitializeSetup(): Boolean;
var
  Installed: String;
begin
  Result := True;
  if RegQueryStringValue(HKLM, UninstallKey, 'DisplayVersion', Installed) and (CompareVersions(Installed, '{#AppVersion}') > 0) then
  begin
    SuppressibleMsgBox(FmtMessage(CustomMessage('NewerInstalled'), [Installed, '{#AppVersion}']), mbCriticalError, MB_OK, IDOK);
    Result := False;
  end;
end;

procedure InitializeWizard();
var
  Dir: String;
begin
  DataDirPage := CreateInputDirPage(wpSelectDir, CustomMessage('DataDirCaption'), CustomMessage('DataDirDescription'), CustomMessage('DataDirSubCaption'), False, '');
  DataDirPage.Add('');
  Dir := PreviousDataDir();
  if Dir = '' then Dir := ExpandConstant('{param:DATADIR|}');
  if Dir = '' then Dir := ExpandConstant('{commonappdata}\VictorFlow');
  DataDirPage.Values[0] := Dir;
end;

{ An upgrade keeps its data folder: moving a live database is not an installer's job. }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = DataDirPage.ID) and (PreviousDataDir() <> '');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = DataDirPage.ID) and not IsUsableDataDir(DataDirPage.Values[0]) then
  begin
    MsgBox(CustomMessage('DataDirInvalid'), mbError, MB_OK);
    Result := False;
  end;
end;

procedure RegisterPreviousData(PreviousDataKey: Integer);
begin
  SetPreviousData(PreviousDataKey, 'DataDir', GetDataDir(''));
end;

function NodeExe(): String;
begin
  Result := ExpandConstant('{app}\node\node.exe');
end;

function VfServer(Args: String): String;
begin
  Result := '"' + ExpandConstant('{app}\vf-server.mjs') + '" ' + Args;
end;

{ Upgrade: stop the running services with the vf-server already installed, so no program file is in use. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Result := '';
  if FileExists(NodeExe()) and FileExists(ExpandConstant('{app}\vf-server.mjs')) then
    if not Exec(NodeExe(), VfServer('stop'), ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
      Result := FmtMessage(CustomMessage('StopFailed'), [IntToStr(Code)]);
end;

procedure ReportFailure(ExitCode: Integer; Message: String);
begin
  SetupExitCode := ExitCode;
  Summary := Message;
  SuppressibleMsgBox(Message, mbCriticalError, MB_OK, IDOK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
  Ini: String;
begin
  if CurStep <> ssPostInstall then Exit;

  { 0 = installed, 1638 = this or a newer version is already there, 3010 = installed, restart later }
  WizardForm.StatusLabel.Caption := CustomMessage('InstallingRuntime');
  if not Exec(ExpandConstant('{tmp}\vc_redist.x64.exe'), '/install /quiet /norestart', '', SW_HIDE, ewWaitUntilTerminated, Code) or ((Code <> 0) and (Code <> 1638) and (Code <> 3010)) then
  begin
    ReportFailure(90, FmtMessage(CustomMessage('RuntimeFailed'), [IntToStr(Code)]));
    Exit;
  end;

  WizardForm.StatusLabel.Caption := CustomMessage('SettingUp');
  if not Exec(NodeExe(), VfServer('setup --data-dir "' + GetDataDir('') + '"'), ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
  begin
    ReportFailure(100 + Code, FmtMessage(CustomMessage('SetupFailed'), [IntToStr(Code), AddBackslash(GetDataDir('')) + 'logs\setup.log']));
    Exit;
  end;

  Ini := AddBackslash(GetDataDir('')) + 'addresses.ini';
  Summary := FmtMessage(CustomMessage('FinishedSummary'), [GetIniString('server', 'api', '', Ini), GetIniString('server', 'tracker', '', Ini), GetIniString('server', 'display', '', Ini), GetIniString('server', 'firstLogin', '', Ini)]);
  if GetIniString('server', 'publicNetwork', '0', Ini) = '1' then
    Summary := Summary + #13#10#13#10 + CustomMessage('PublicNetwork');
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpFinished) and (Summary <> '') then
    WizardForm.FinishedLabel.Caption := Summary;
end;

{ Silent installs (and CI) see a failed setup in the exit code: 90 = runtime, 100 + the vf-server exit code. }
function GetCustomSetupExitCode(): Integer;
begin
  Result := SetupExitCode;
end;

function InitializeUninstall(): Boolean;
begin
  DataDirAtUninstall := '';
  RegQueryStringValue(HKLM, UninstallKey, 'Inno Setup CodeFile: DataDir', DataDirAtUninstall);
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and (DataDirAtUninstall <> '') and not UninstallSilent() then
    MsgBox(FmtMessage(CustomMessage('DataKept'), [DataDirAtUninstall]), mbInformation, MB_OK);
end;
