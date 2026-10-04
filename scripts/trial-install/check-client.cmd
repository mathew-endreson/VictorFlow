@echo off
rem VictorFlow trial install: checks that THIS PC reaches the server and writes report-client.txt here.
rem Usage: double-click and type the server address, or: check-client.cmd 192.168.1.10:3000
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-client.ps1" %*
pause
