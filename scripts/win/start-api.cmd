@echo off
setlocal
cd /d "%~dp0..\.."
echo === DukaanDesk Pro API (Nest) on :3847 — %CD% ===
pnpm dev:api
endlocal
