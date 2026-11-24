@echo off
title DD Lite API 4047
call "%USERPROFILE%\dukaandeskprodata\proenv.cmd"
cd /d "%DD_LITE_APP%\apps\api"
node dist\main.js
