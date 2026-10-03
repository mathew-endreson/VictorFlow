@echo off
rem VictorFlow Server command line, from the program folder: vf-server status ^| start ^| stop ^| setup ^| remove ^| help
"%~dp0node\node.exe" "%~dp0vf-server.mjs" %*
