@echo off
echo ==========================================
echo   Team Sync - Premiere Pro Extension
echo   One-Click Installer
echo ==========================================
echo.

:: Check for admin rights (needed for registry)
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:: Set paths
set "EXT_ID=com.premieresync.panel"
set "CEP_DIR=%APPDATA%\Adobe\CEP\extensions"
set "INSTALL_DIR=%CEP_DIR%\%EXT_ID%"
set "SOURCE_DIR=%~dp0premiere-extension"

echo [1/3] Enabling CEP Debug Mode...
:: Try multiple CSXS versions for compatibility
reg add "HKCU\Software\Adobe\CSXS.8" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.9" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
echo    [OK] Debug mode enabled

echo.
echo [2/3] Installing extension...

:: Create extensions directory if it doesn't exist
if not exist "%CEP_DIR%" (
    mkdir "%CEP_DIR%"
    echo    [OK] Created extensions directory
)

:: Remove old version if exists
if exist "%INSTALL_DIR%" (
    echo    [..] Removing old version...
    rmdir /s /q "%INSTALL_DIR%"
)

:: Copy extension files
echo    [..] Copying files...
xcopy "%SOURCE_DIR%" "%INSTALL_DIR%\" /e /i /q /y >nul 2>&1

if %errorlevel% neq 0 (
    echo    [ERROR] Failed to copy files!
    echo    Make sure the 'premiere-extension' folder exists next to this installer.
    pause
    exit /b 1
)
echo    [OK] Extension installed

echo.
echo [3/3] Cleaning up...
:: Remove dev files from installed copy
if exist "%INSTALL_DIR%\.debug" del "%INSTALL_DIR%\.debug" >nul 2>&1
if exist "%INSTALL_DIR%\OAUTH_SETUP_STEPS.md" del "%INSTALL_DIR%\OAUTH_SETUP_STEPS.md" >nul 2>&1
if exist "%INSTALL_DIR%\oauth-activation-html.txt" del "%INSTALL_DIR%\oauth-activation-html.txt" >nul 2>&1
echo    [OK] Cleaned up dev files

echo.
echo ==========================================
echo   Installation Complete!
echo ==========================================
echo.
echo   Next steps:
echo   1. Open (or restart) Adobe Premiere Pro
echo   2. Go to: Window ^> Extensions ^> Team Sync
echo   3. Click "Connect Google Drive" to sign in
echo.
echo   Extension installed to:
echo   %INSTALL_DIR%
echo.
pause
