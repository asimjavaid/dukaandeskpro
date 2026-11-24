@echo off
rem Stops only the Lite test copy: whatever listens on 4047, 5373, 5375, then its own PostgreSQL.
call "%USERPROFILE%\dukaandeskprodata\proenv.cmd"
powershell -NoProfile -Command "foreach($p in 4047,5373,5375){Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }}"
"%DD_PG_BIN%\pg_ctl.exe" -D "%DD_LITE_DATA%\pg17" -m fast stop
