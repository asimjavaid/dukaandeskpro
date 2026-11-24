@echo off
title DD Lite Web 5373
call "%USERPROFILE%\dukaandeskprodata\proenv.cmd"
cd /d "%DD_LITE_APP%\apps\web"
node node_modules\vite\bin\vite.js --port %VITE_PORT% --strictPort --host 127.0.0.1
