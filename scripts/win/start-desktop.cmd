@echo off
setlocal
cd /d "%~dp0..\.."
echo === DukaanDesk Pro Electron — start Vite (start-web.cmd) first — %CD% ===
pnpm dev:desktop
endlocal
