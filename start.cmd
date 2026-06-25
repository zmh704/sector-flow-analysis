@echo off
cd /d "%~dp0"
echo ====================================
echo  A股板块资金流向分析
echo ====================================
echo.
echo 正在启动服务器...
echo.
start http://localhost:3000
node server.js
pause
