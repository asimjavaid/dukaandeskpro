<#
  DukaanDesk Pro - local TEST copy on this Windows PC (per user, no services, no firewall).
  Run from the kit folder (not as admin):
     powershell -ExecutionPolicy Bypass -File .\deploypro.ps1              # demo data
     powershell -ExecutionPolicy Bypass -File .\deploypro.ps1 -Data p1     # import a COPY of the P1 database
  Never touches %USERPROFILE%\dukaandesk (P1), its database, or ports 3847/5173.
  Lite: API 4047, web 5373, second till 5375, PostgreSQL 5453 (127.0.0.1 only).
  Code  -> %USERPROFILE%\dukaandeskpro
  Data  -> %USERPROFILE%\dukaandeskprodata
#>
param(
  [ValidateSet('demo', 'p1')] [string]$Data = 'demo',
  [string]$P1Db = '',
  [switch]$NoStart,
  [string]$NodeDir = 'C:\Program Files\nodejs'
)
$ErrorActionPreference = 'Stop'
$Kit   = $PSScriptRoot
$U     = $env:USERPROFILE
$P1    = Join-Path $U 'dukaandesk'
$App   = Join-Path $U 'dukaandeskpro'
$DataD = Join-Path $U 'dukaandeskprodata'
$PgVer = '17.11-5'
$PgUrl = "https://get.enterprisedb.com/postgresql/postgresql-$PgVer-windows-x64-binaries.zip"
$PgSha = '80379B2C04D51C30225532E0AE04509899141E9957ED096FE749D7FD9DF8F82F'
$Ports = @{ api = 4047; web = 5373; till2 = 5375; pg = 5453 }

New-Item -ItemType Directory -Force -Path $DataD | Out-Null
$Log = Join-Path $DataD 'deploy-log.txt'
function Say($m) { $l = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m"; Write-Host $l; Add-Content -Path $Log -Value $l }
function Die($m) { Say "STOP: $m"; exit 1 }

# Hash a file without locking it (P1 may have it open).
function Get-SharedHash($p) {
  $fs = [System.IO.File]::Open($p, 'Open', 'Read', 'ReadWrite,Delete')
  try { $sha = [System.Security.Cryptography.SHA256]::Create(); ([BitConverter]::ToString($sha.ComputeHash($fs))).Replace('-', '') } finally { $fs.Dispose() }
}
function Copy-Shared($src, $dst) {
  $in = [System.IO.File]::Open($src, 'Open', 'Read', 'ReadWrite,Delete')
  try { $out = [System.IO.File]::Create($dst); try { $in.CopyTo($out) } finally { $out.Dispose() } } finally { $in.Dispose() }
}
function Http($url) {
  try { $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5; return @{ code = [int]$r.StatusCode; body = $r.Content } }
  catch { $c = 0; if ($_.Exception.Response) { $c = [int]$_.Exception.Response.StatusCode }; return @{ code = $c; body = '' } }
}
function PortBusy($p) { [bool](Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) }
function P1Files {
  if (-not (Test-Path $P1)) { return @() }
  Get-ChildItem -Path $P1 -Recurse -File -Include *.sqlite, *.sqlite-wal, *.db, *.db-wal -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\|\\dist\\' }
}
function P1Snapshot {
  $files = @{}
  foreach ($f in P1Files) { try { $files[$f.FullName] = "$(Get-SharedHash $f.FullName) $($f.Length) $($f.LastWriteTimeUtc.ToString('o'))" } catch { $files[$f.FullName] = "unreadable: $($_.Exception.Message)" } }
  @{ files = $files; api = (Http 'http://127.0.0.1:3847/health').code; web = (Http 'http://127.0.0.1:5173/').code }
}

Say "== DukaanDesk Pro local test deploy =="
if ($App -ieq $P1 -or $DataD -ieq $P1) { Die 'target equals the P1 folder' }

# 1. P1 before
$before = P1Snapshot
Say "P1 before: api 3847 -> $($before.api), web 5173 -> $($before.web), $($before.files.Count) db file(s)"
foreach ($k in $before.files.Keys) { Say "  P1 $k = $($before.files[$k])" }

# 2. Ports
foreach ($n in $Ports.Keys) { if (PortBusy $Ports[$n]) { Die "port $($Ports[$n]) ($n) is already in use" } }

# 3. Node 20 (same as P1: Program Files\nodejs, put first only for this script + Lite launchers) + pnpm 10 via corepack
if (Test-Path (Join-Path $NodeDir 'node.exe')) { $env:PATH = "$NodeDir;$env:PATH" }
$nodeV = (& node -v) 2>$null
if (-not $nodeV -or -not $nodeV.StartsWith('v20.')) { Die "Node 20 needed (found '$nodeV'). Install Node 20 LTS for this user (nvm-windows or the zip) and run again." }
function Pnpm { & corepack pnpm@10.33.4 @args }
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
$pnpmV = (Pnpm -v)
if (-not "$pnpmV".StartsWith('10.')) { Die "pnpm 10 via corepack failed ($pnpmV)" }
Say "node $nodeV, pnpm $pnpmV"

# 4. Code
$zip = Join-Path $Kit 'dukaandeskpro-src.zip'
if (-not (Test-Path $zip)) { Die "missing $zip" }
if ((Test-Path $App) -and (Get-ChildItem $App -Force | Select-Object -First 1)) {
  Die "$App already exists. Rename or delete it first (only this Lite folder)."
}
New-Item -ItemType Directory -Force -Path $App | Out-Null
Expand-Archive -Path $zip -DestinationPath $App -Force
Say "code copied to $App"
# Big image-cutout model files are left out of the kit; take identical copies from P1 (read only, hash checked).
$bgWant = @{
  'isnet-q8.onnx' = 'F1B1C6F7656E532627697AFC989D953BE1E7EF8F55A718F3611E8C9FD50CDEF7'
  'ort-wasm-simd-threaded.mjs' = 'E9BA2350C370278FC90108F1514FB9CE6A4051341AB977B5B0DCA7ECA9E78DFA'
  'ort-wasm-simd-threaded.wasm' = '06B3F98E5AA2FFFEC1E3AC57A48BF1073828C6624E14D210750BC596C2E35D65'
}
$bgDst = Join-Path $App 'apps\web\public\bg-model'; $bgSrc = Join-Path $P1 'apps\web\public\bg-model'
New-Item -ItemType Directory -Force -Path $bgDst | Out-Null
foreach ($n in $bgWant.Keys) {
  $d = Join-Path $bgDst $n; $s = Join-Path $bgSrc $n
  if (Test-Path $d) { continue }
  if ((Test-Path $s) -and ((Get-SharedHash $s) -eq $bgWant[$n])) { Copy-Shared $s $d; Say "bg-model $n copied from P1 (same hash)" }
  else { Say "bg-model $n not available: image cut-out will not work in the Lite test copy" }
}
Push-Location $App
Pnpm install --frozen-lockfile; if ($LASTEXITCODE -ne 0) { Pop-Location; Die 'pnpm install failed' }
Pnpm build; if ($LASTEXITCODE -ne 0) { Pop-Location; Die 'build failed' }
Pop-Location
Say 'pnpm install + build done'

# 5. Portable PostgreSQL 17 (per user, 127.0.0.1:5453, no service)
$dl = Join-Path $DataD 'downloads'; New-Item -ItemType Directory -Force -Path $dl | Out-Null
$pgZip = Join-Path $dl "postgresql-$PgVer-windows-x64-binaries.zip"
if (-not (Test-Path $pgZip)) { Say "downloading $PgUrl"; $ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri $PgUrl -OutFile $pgZip }
$h = (Get-FileHash $pgZip -Algorithm SHA256).Hash
if ($h -ne $PgSha) { Remove-Item $pgZip; Die "PostgreSQL zip SHA-256 mismatch ($h)" }
$pgHome = Join-Path $DataD 'pgsql'
if (-not (Test-Path (Join-Path $pgHome 'bin\pg_ctl.exe'))) { Expand-Archive -Path $pgZip -DestinationPath $DataD -Force }
$bin = Join-Path $pgHome 'bin'
$pgData = Join-Path $DataD 'pg17'
if (-not (Test-Path (Join-Path $pgData 'PG_VERSION'))) {
  & "$bin\initdb.exe" -D $pgData -U postgres -A trust -E UTF8 --locale=C | Out-Null
  if ($LASTEXITCODE -ne 0) { Die 'initdb failed' }
  Add-Content -Path (Join-Path $pgData 'postgresql.conf') -Value "`nlisten_addresses = '127.0.0.1'`nport = $($Ports.pg)`n"
  Say "PostgreSQL cluster created in $pgData (127.0.0.1:$($Ports.pg), local trust only)"
}
& "$bin\pg_ctl.exe" -D $pgData -l (Join-Path $DataD 'pg17.log') -w start | Out-Null
& "$bin\psql.exe" -h 127.0.0.1 -p $Ports.pg -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='dukaandeskpro'" | Set-Variable have
if (-not $have) { & "$bin\createdb.exe" -h 127.0.0.1 -p $Ports.pg -U postgres -E UTF8 -T template0 dukaandeskpro; Say 'database dukaandeskpro created' }

# 6. Environment for the launchers
$secret = -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
$envCmd = @"
@rem DukaanDesk Pro local test settings (made by deploypro.ps1)
set "PATH=$NodeDir;%PATH%"
set "DD_LITE_APP=$App"
set "DD_LITE_DATA=$DataD"
set "DATABASE_URL=postgres://postgres@127.0.0.1:$($Ports.pg)/dukaandeskpro"
set "SQLITE_PATH=$DataD\lite.db"
set "API_PORT=$($Ports.api)"
set "SESSION_SECRET=$secret"
set "DD_PG_BIN=$bin"
set "DD_BACKUP_DIR=$DataD\backups"
set "RESET_BACKUP_DIR=$DataD\reset-backups"
set "TAX_PROCESS_INTERVAL_MS=0"
set "DD_API_URL=http://127.0.0.1:$($Ports.api)"
set "VITE_PORT=$($Ports.web)"
set "DD_TILL_PORT=$($Ports.till2)"
set "DD_TILL_CONFIG=$DataD\till2\till.json"
"@
Set-Content -Path (Join-Path $DataD 'proenv.cmd') -Value $envCmd -Encoding ASCII
foreach ($f in 'ddpropg.cmd', 'ddproapi.cmd', 'ddproweb.cmd', 'ddprotill2.cmd', 'startpro.cmd', 'stoppro.cmd') {
  Copy-Item (Join-Path $Kit $f) (Join-Path $App $f) -Force
}
Copy-Item (Join-Path $Kit 'TEST-GUIDE-PRO.md') (Join-Path $U 'TEST-GUIDE-PRO.md') -Force
Say "launchers in $App, guide at $U\TEST-GUIDE-PRO.md"

# 7. Data: P1 import (from a private copy) or demo
$env:DATABASE_URL = "postgres://postgres@127.0.0.1:$($Ports.pg)/dukaandeskpro"
$env:DD_PG_BIN = $bin
if ($Data -eq 'p1') {
  if (-not $P1Db) {
    $cand = P1Files | Where-Object { $_.Extension -in '.sqlite', '.db' } | Sort-Object Length -Descending | Select-Object -First 1
    if (-not $cand) { Die 'no P1 database found; pass -P1Db C:\path\dukaandesk.sqlite' }
    $P1Db = $cand.FullName
  }
  $copyDir = Join-Path $DataD 'p1-copy'; New-Item -ItemType Directory -Force -Path $copyDir | Out-Null
  $copy = Join-Path $copyDir ("p1-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.sqlite')
  Copy-Shared $P1Db $copy
  foreach ($sfx in '-wal', '-shm') { if (Test-Path "$P1Db$sfx") { Copy-Shared "$P1Db$sfx" "$copy$sfx" } }
  Say "P1 database copied read-only: $P1Db -> $copy"
  Push-Location $App
  & node tools\import-p1\import-p1.cjs $copy --report (Join-Path $DataD 'import-report.json')
  $rc = $LASTEXITCODE; Pop-Location
  if ($rc -ne 0) { Die "import-p1 failed ($rc)" }
  Say 'P1 copy imported into Lite'
}

# 8. Start (Explorer-style, so the windows outlive this script) and check
if (-not $NoStart) {
  Start-Process -FilePath 'explorer.exe' -ArgumentList "`"$App\startpro.cmd`""
  Say 'startpro.cmd launched'
  $ok = $false
  for ($i = 0; $i -lt 90; $i++) { Start-Sleep 2; $hl = Http "http://127.0.0.1:$($Ports.api)/health"; if ($hl.code -eq 200) { $ok = $true; break } }
  if (-not $ok) { Die 'API did not answer on 4047 (see the DD Lite API window)' }
  $hj = $hl.body | ConvertFrom-Json
  Say "health: engine=$($hj.engine) product=$($hj.product)"
  if ($hj.engine -ne 'postgres') { Die "engine is $($hj.engine), expected postgres" }
  $p401 = (Http "http://127.0.0.1:$($Ports.api)/catalog/products").code
  Say "no-session call -> $p401 (want 401)"
  if ($Data -eq 'demo') {
    Push-Location $App; & node (Join-Path $Kit 'seed-demo.mjs') "http://127.0.0.1:$($Ports.api)"; $rc = $LASTEXITCODE; Pop-Location
    if ($rc -ne 0) { Say 'demo seed: skipped or failed (see above)' } else { Say 'demo data added' }
  }
  for ($i = 0; $i -lt 60; $i++) { Start-Sleep 2; if ((Http "http://127.0.0.1:$($Ports.web)/").code -eq 200) { break } }
  Say "web 5373 -> $((Http "http://127.0.0.1:$($Ports.web)/").code) (want 200)"
  Say "till 2 5375 -> $((Http "http://127.0.0.1:$($Ports.till2)/__till/status").code) (want 200)"
}

# 9. P1 after
Start-Sleep 2
$after = P1Snapshot
$same = $true
foreach ($k in $before.files.Keys) {
  $a = $before.files[$k].Split(' ')[0]; $b = ''
  if ($after.files.ContainsKey($k)) { $b = $after.files[$k].Split(' ')[0] }
  if ($a -ne $b) { $same = $false; Say "  P1 CHANGED? $k $a -> $b (P1 itself may have written if it is running)" }
}
Say "P1 after: api 3847 -> $($after.api) (was $($before.api)), web 5173 -> $($after.web) (was $($before.web)), files same: $same"
Say "== done. Lite: http://127.0.0.1:$($Ports.web)  (till 2: http://127.0.0.1:$($Ports.till2))  guide: $U\TEST-GUIDE-PRO.md =="
