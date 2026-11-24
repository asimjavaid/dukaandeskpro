@echo off
rem DukaanDesk Pro test copy: PostgreSQL 17 on 127.0.0.1:5453 (per user, no service).
call "%USERPROFILE%\dukaandeskprodata\proenv.cmd"
"%DD_PG_BIN%\pg_ctl.exe" -D "%DD_LITE_DATA%\pg17" status >nul 2>&1
if %errorlevel%==0 (echo PostgreSQL already running.& goto :eof)
"%DD_PG_BIN%\pg_ctl.exe" -D "%DD_LITE_DATA%\pg17" -l "%DD_LITE_DATA%\pg17.log" -w start
