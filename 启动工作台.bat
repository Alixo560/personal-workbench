@echo off
chcp 65001 >nul
title 个人工作台
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Node.js，请先安装 Node 22 或更高版本：https://nodejs.org/
  pause
  exit /b 1
)
node server.js --open
echo.
echo 服务已停止。
pause
