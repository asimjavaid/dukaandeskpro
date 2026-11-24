@echo off
setlocal
cd /d "%~dp0..\.."
echo === DukaanDesk Pro production — built web + Nest, local SQLite — %CD% ===
echo Requires: pnpm build:desktop already done, Node 20 on PATH for this window only.
pnpm start:prod
endlocal
