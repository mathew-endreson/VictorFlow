@echo off
rem VictorFlow trial install: checks the SERVER PC and writes report-server.txt here. Asks for administrator rights.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-server.ps1" %*
pause
