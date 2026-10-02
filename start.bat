@echo off
title Mini Quiz Classroom Server

echo ========================================================
echo   Starting Mini Quiz Classroom Server...
echo ========================================================
echo.

cd /d "%~dp0"

:: Dat port mac dinh cho moi truong chay cuc bo
set PORT=7788

:: Giai phong port 7788 neu dang bi chiem
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :7788 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Mo trinh duyet vao trang index sau 1 giay
start "" cmd /c "timeout /t 1 /nobreak >nul && start http://localhost:7788"

:: Chay server
node server.js

pause
