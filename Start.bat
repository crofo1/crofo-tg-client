@echo off
title CROFO Telegram Client Launcher
cd /d "D:\crofo-tg-client"
echo [INIT] Starting CROFO Telegram Client Launcher...

where py >nul 2>nul
if %errorlevel% equ 0 (
    py "%~dp0launch.py"
) else (
    python "%~dp0launch.py"
)
exit
