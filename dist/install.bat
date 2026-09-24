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

:: Remove Team Sync copies in Program Files: they are read-only, can't auto-update,
:: and a duplicate bundle ID makes Premiere load either copy unpredictably.
set "CPF=%CommonProgramFiles%"
set "CPF86=%CommonProgramFiles(x86)%"
for /d %%A in ("%ProgramFiles%\Adobe\*") do call :remove_copies "%%~A\CEP\extensions"
call :remove_copies "%CPF%\Adobe\CEP\extensions"
call :remove_copies "%CPF86%\Adobe\CEP\extensions"

:: Leftovers an old updater bug wrote straight into %APPDATA%\Adobe\CEP\
set "CEP_ROOT=%APPDATA%\Adobe\CEP"
if exist "%CEP_ROOT%\CSXS\manifest.xml" (
    findstr /c:"%EXT_ID%" "%CEP_ROOT%\CSXS\manifest.xml" >nul 2>&1 && (
        echo    [..] Removing stray files from %CEP_ROOT%
        for %%D in (client CSXS host icons test) do if exist "%CEP_ROOT%\%%D" rmdir /s /q "%CEP_ROOT%\%%D"
        for %%F in (version.json files.json .debug OAUTH_SETUP_STEPS.md oauth-activation-html.txt TESTING.md) do if exist "%CEP_ROOT%\%%F" del /q "%CEP_ROOT%\%%F"
    )
)

:: A symlink/junction here (e.g. a dev link to a drive that no longer exists): remove the link only
fsutil reparsepoint query "%INSTALL_DIR%" >nul 2>&1 && (
    echo    [..] Removing old link at %INSTALL_DIR%
    rmdir "%INSTALL_DIR%"
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
exit /b 0

:: ---- remove every Team Sync copy directly inside folder %1 ----
:remove_copies
if not exist "%~1" exit /b 0
for /d %%E in ("%~1\*") do (
    if exist "%%~E\CSXS\manifest.xml" (
        findstr /c:"%EXT_ID%" "%%~E\CSXS\manifest.xml" >nul 2>&1 && (
            echo    [..] Removing old copy: %%~E
            rmdir /s /q "%%~E"
        )
    )
)
exit /b 0
