@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0StartServer.ps1"
pause
