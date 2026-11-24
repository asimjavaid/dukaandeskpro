@echo off
setlocal
cd /d "%~dp0..\.."
echo === DukaanDesk Pro Windows installer (NSIS + portable) — %CD% ===
echo No auto-update. No code signing. Run on this Windows PC, not from Linux.
pnpm package:win
endlocal
