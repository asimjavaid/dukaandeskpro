@echo off
setlocal
cd /d "%~dp0..\.."
echo === DukaanDesk Pro: pnpm install (repo: %CD%) ===
where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm not found. Enable Corepack or: npm install -g pnpm@10.33.4
  exit /b 1
)
pnpm install
echo.
echo Done. Next: start-api.cmd then start-web.cmd
endlocal
