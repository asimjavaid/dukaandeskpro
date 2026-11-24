<#
  DukaanDesk Pro - uninstall on the main PC (elevated). UNTESTED ON WINDOWS.
  Stops and removes both services and the firewall rules. KEEPS %ProgramData%\dukaandeskpro
  (shop data, backups, licence) so a reinstall finds everything. -Purge deletes it (asks twice in the UI).
#>
param([Parameter(Mandatory = $true)][string]$AppDir, [switch]$Purge)
$ErrorActionPreference = 'Continue'
$Res = Join-Path $AppDir 'resources'
$Svc = Join-Path $Res 'winsw\DukaanDeskProServer.exe'
if (Get-Service -Name DukaanDeskProServer -ErrorAction SilentlyContinue) { & $Svc stop; & $Svc uninstall }
if (Get-Service -Name DukaanDeskProPG -ErrorAction SilentlyContinue) {
  Stop-Service DukaanDeskProPG -Force
  & (Join-Path $Res 'pgsql\bin\pg_ctl.exe') unregister -N DukaanDeskProPG
}
netsh advfirewall firewall delete rule name="DukaanDesk Pro API" | Out-Null
netsh advfirewall firewall delete rule name="DukaanDesk Pro discovery" | Out-Null
if ($Purge) { Remove-Item -Recurse -Force (Join-Path $env:ProgramData 'dukaandeskpro') }
