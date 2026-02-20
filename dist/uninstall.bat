@echo off
echo ==========================================
echo   Team Sync - Uninstaller
echo ==========================================
echo.

:: Check for admin rights
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

set "EXT_ID=com.premieresync.panel"
set "INSTALL_DIR=%APPDATA%\Adobe\CEP\extensions\%EXT_ID%"

if exist "%INSTALL_DIR%" (
    echo Removing Team Sync extension...
    rmdir /s /q "%INSTALL_DIR%"
    echo [OK] Extension removed!
) else (
    echo Extension is not installed.
)

echo.
pause
