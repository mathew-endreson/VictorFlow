@echo off
rem VictorFlow trial install, after uninstalling the server: checks that the services are gone and the data folder stayed.
rem Writes report-server-after-uninstall.txt here. Asks for administrator rights.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-server.ps1" -ReportPath "%~dp0report-server-after-uninstall.txt" %*
pause
