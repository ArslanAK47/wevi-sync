@echo off
echo ==========================================
echo   Team Sync - Build Distribution Package
echo ==========================================
echo.

set "DIST_DIR=%~dp0dist"
set "SOURCE_DIR=%~dp0premiere-extension"

echo [1/3] Cleaning dist folder...
if exist "%DIST_DIR%\premiere-extension" rmdir /s /q "%DIST_DIR%\premiere-extension"
mkdir "%DIST_DIR%\premiere-extension"

echo [2/3] Copying extension files (excluding dev files)...

:: Copy core folders
xcopy "%SOURCE_DIR%\CSXS" "%DIST_DIR%\premiere-extension\CSXS\" /e /i /q /y >nul
xcopy "%SOURCE_DIR%\client" "%DIST_DIR%\premiere-extension\client\" /e /i /q /y >nul
xcopy "%SOURCE_DIR%\host" "%DIST_DIR%\premiere-extension\host\" /e /i /q /y >nul
xcopy "%SOURCE_DIR%\icons" "%DIST_DIR%\premiere-extension\icons\" /e /i /q /y >nul

:: Copy version.json (needed for auto-update version checking)
copy "%SOURCE_DIR%\version.json" "%DIST_DIR%\premiere-extension\version.json" /y >nul 2>&1

:: Remove dev/debug files from the copy
if exist "%DIST_DIR%\premiere-extension\.debug" del "%DIST_DIR%\premiere-extension\.debug" >nul 2>&1
if exist "%DIST_DIR%\premiere-extension\OAUTH_SETUP_STEPS.md" del "%DIST_DIR%\premiere-extension\OAUTH_SETUP_STEPS.md" >nul 2>&1
if exist "%DIST_DIR%\premiere-extension\oauth-activation-html.txt" del "%DIST_DIR%\premiere-extension\oauth-activation-html.txt" >nul 2>&1

echo    [OK] Files copied

echo [3/3] Creating zip package...
powershell -Command "Compress-Archive -Path '%DIST_DIR%\install.bat', '%DIST_DIR%\uninstall.bat', '%DIST_DIR%\README.txt', '%DIST_DIR%\premiere-extension' -DestinationPath '%DIST_DIR%\TeamSync-Installer.zip' -Force"

if %errorlevel% equ 0 (
    echo    [OK] Package created!
) else (
    echo    [WARN] Could not create zip. You can manually zip the dist folder.
)

echo.
echo ==========================================
echo   Build Complete!
echo ==========================================
echo.
echo   Distribution package:
echo   %DIST_DIR%\TeamSync-Installer.zip
echo.
echo   Contents:
echo   - install.bat       (one-click installer)
echo   - uninstall.bat     (clean uninstall)
echo   - README.txt        (instructions)
echo   - premiere-extension (extension files)
echo.
echo   Send the zip file to your editor!
echo.
pause
