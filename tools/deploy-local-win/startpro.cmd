@echo off
rem Starts PostgreSQL, the Lite API, the web screen and a second till on this PC, then opens the browser.
rem Does not touch DukaanDesk P1 (ports 3847/5173).
cd /d "%~dp0"
call "%~dp0ddpropg.cmd"
start "DD Lite API 4047" cmd /k "%~dp0ddproapi.cmd"
start "DD Lite Web 5373" cmd /k "%~dp0ddproweb.cmd"
start "DD Lite Till 2 (5375)" cmd /k "%~dp0ddprotill2.cmd"
powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5373/ -TimeoutSec 2 | Out-Null; exit 0}catch{Start-Sleep 2}}"
start "" http://127.0.0.1:5373/
