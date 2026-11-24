<#
  DukaanDesk Pro - main PC setup (run elevated by the installer, once per install/upgrade).
  UNTESTED ON WINDOWS (written and syntax-reviewed on Linux; see docs/INSTALLER-LITE.md).

  1. Bundled PostgreSQL 17 (resources\pgsql) -> data in %ProgramData%\dukaandeskpro\pgdata,
     service "DukaanDeskProPG", port 5449, listens on 127.0.0.1 only, scram-sha-256 password.
  2. Database "dukaandesk", role "dukaandesk" with a generated password.
  3. %ProgramData%\dukaandeskpro\server.json + session secret (SYSTEM + Administrators only).
  4. Service "DukaanDeskProServer" (WinSW) running the API with the app's Electron as Node.
  5. Firewall: TCP 3847 (API) + UDP 3849 (till discovery), Private networks only.
  Re-running keeps existing data, password and secret.
#>
param(
  [Parameter(Mandatory = $true)][string]$AppDir,          # e.g. C:\Program Files\DukaanDesk Pro
  [ValidateSet('main-till', 'server-only')][string]$Mode = 'main-till',
  [int]$PgPort = 5449,
  [int]$ApiPort = 3847,
  [int]$DiscoveryPort = 3849
)
$ErrorActionPreference = 'Stop'
$Res      = Join-Path $AppDir 'resources'
$PgBin    = Join-Path $Res 'pgsql\bin'
$Data     = Join-Path $env:ProgramData 'dukaandeskpro'
$PgData   = Join-Path $Data 'pgdata'
$Logs     = Join-Path $Data 'logs'
$Backups  = Join-Path $Data 'backups'
$Lic      = Join-Path $Data 'licence'
$PwFile   = Join-Path $Data 'pg.secret'
$SessFile = Join-Path $Data 'session.secret'
$CfgFile  = Join-Path $Data 'server.json'
New-Item -ItemType Directory -Force -Path $Data, $Logs, $Backups, $Lic | Out-Null

function New-Secret([int]$bytes = 24) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return ([Convert]::ToBase64String($b) -replace '[+/=]', 'x')
}
if (-not (Test-Path $PwFile))   { Set-Content -NoNewline -Path $PwFile   -Value (New-Secret) }
if (-not (Test-Path $SessFile)) { Set-Content -NoNewline -Path $SessFile -Value (New-Secret 32) }
$Pw = (Get-Content -Raw $PwFile).Trim()

# Lock the folder: SYSTEM + Administrators full; the shop user gets nothing (the API runs as SYSTEM).
icacls $Data /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
# PostgreSQL's service runs as NetworkService: it needs its data and log folders (not the secrets).
New-Item -ItemType Directory -Force -Path $PgData | Out-Null
icacls $Data /grant '*S-1-5-20:(RX)' | Out-Null
icacls $PgData /grant '*S-1-5-20:(OI)(CI)F' | Out-Null
icacls $Logs /grant '*S-1-5-20:(OI)(CI)M' | Out-Null

# 1. PostgreSQL cluster
if (-not (Test-Path (Join-Path $PgData 'PG_VERSION'))) {
  Get-ChildItem -Force $PgData | Remove-Item -Recurse -Force  # half-made cluster from a failed run
  $tmpPw = Join-Path $env:TEMP ("ddpw-" + [guid]::NewGuid() + '.txt')
  Set-Content -NoNewline -Path $tmpPw -Value $Pw
  try {
    & (Join-Path $PgBin 'initdb.exe') -D $PgData -U dukaandesk --pwfile=$tmpPw --auth=scram-sha-256 -E UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw "initdb failed ($LASTEXITCODE)" }
  } finally { Remove-Item -Force $tmpPw -ErrorAction SilentlyContinue }
  Add-Content -Path (Join-Path $PgData 'postgresql.conf') -Value @"

# DukaanDesk Pro
listen_addresses = '127.0.0.1'
port = $PgPort
max_connections = 30
shared_buffers = 128MB
logging_collector = on
log_directory = '$($Logs -replace '\\','/')'
"@
}
if (-not (Get-Service -Name DukaanDeskProPG -ErrorAction SilentlyContinue)) {
  & (Join-Path $PgBin 'pg_ctl.exe') register -N DukaanDeskProPG -D $PgData -S auto -w -U 'NT AUTHORITY\NetworkService'
  if ($LASTEXITCODE -ne 0) { throw "pg_ctl register failed ($LASTEXITCODE)" }
}
Start-Service DukaanDeskProPG
$env:PGPASSWORD = $Pw
$exists = & (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -p $PgPort -U dukaandesk -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='dukaandesk'"
if ($exists -ne '1') {
  & (Join-Path $PgBin 'createdb.exe') -h 127.0.0.1 -p $PgPort -U dukaandesk -E UTF8 -T template0 dukaandesk
  if ($LASTEXITCODE -ne 0) { throw "createdb failed ($LASTEXITCODE)" }
}
Remove-Item Env:PGPASSWORD

# 3. server.json (read by the API service; the desktop app only checks that it exists)
$cfg = [ordered]@{
  databaseUrl       = "postgres://dukaandesk:$Pw@127.0.0.1:$PgPort/dukaandesk"
  pgBin             = $PgBin
  lan               = $true
  installMode       = $Mode
  apiPort           = $ApiPort
  backupDir         = $Backups
  licenceHome       = $Lic
  sessionSecretFile = $SessFile
}
$cfg | ConvertTo-Json | Set-Content -Path $CfgFile -Encoding UTF8

# 4. API service (WinSW, MIT licence): resources\winsw\DukaanDeskProServer.exe + .xml
$Svc = Join-Path $Res 'winsw\DukaanDeskProServer.exe'
if (-not (Get-Service -Name DukaanDeskProServer -ErrorAction SilentlyContinue)) {
  & $Svc install
  if ($LASTEXITCODE -ne 0) { throw "server service install failed ($LASTEXITCODE)" }
}
& $Svc restart | Out-Null

# 5. Firewall (Private profile only; Public Wi-Fi stays closed)
foreach ($r in @(@{n='DukaanDesk Pro API'; p='TCP'; port=$ApiPort}, @{n='DukaanDesk Pro discovery'; p='UDP'; port=$DiscoveryPort})) {
  netsh advfirewall firewall delete rule name="$($r.n)" | Out-Null
  netsh advfirewall firewall add rule name="$($r.n)" dir=in action=allow protocol=$($r.p) localport=$($r.port) profile=private | Out-Null
}
Write-Output "DukaanDesk Pro main PC ready ($Mode)"
