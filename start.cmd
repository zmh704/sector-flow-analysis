@echo off
cd /d "%~dp0"
echo ====================================
echo  GP分析系统
echo ====================================
echo.
echo 正在启动服务器...
echo.
start http://localhost:3001
node server.js
pause
