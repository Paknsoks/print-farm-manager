@echo off
set "LOG=%~dp0slicer-upload.log"
echo ===== %date% %time% ===== >> "%LOG%" 2>nul
node "%~dp0slicer-upload.js" %* 2>> "%LOG%"

:: If --verbose or -v was passed, pause so the user can read output
echo %* | findstr /i "\-\-verbose \-v" >nul
if %errorlevel% equ 0 pause