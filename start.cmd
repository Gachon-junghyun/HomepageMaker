@echo off
chcp 65001 >nul
cd /d "%~dp0app"
if not exist node_modules (
  echo [homepage-maker] npm install ...
  call npm install || exit /b 1
  if not exist node_moduleslectron\dist call node node_moduleslectron\install.js
)
call npx electron-vite build || exit /b 1
start "" npx electron .
