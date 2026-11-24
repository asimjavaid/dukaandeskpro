@echo off
setlocal
cd /d "%~dp0..\.."
echo === DukaanDesk Pro Web (Vite) http://localhost:5173 — %CD% ===
pnpm dev:web
endlocal
