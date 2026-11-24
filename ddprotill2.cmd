@echo off
title DD Lite Till 2 (5375)
call "%USERPROFILE%\dukaandeskprodata\proenv.cmd"
cd /d "%DD_LITE_APP%"
node apps\desktop\src\till-link.js
