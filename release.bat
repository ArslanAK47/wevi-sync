@echo off
:: Publish a new Team Sync version to every editor.
:: Double-click it and answer the questions, or run it with arguments:
::   release.bat patch "Fixed pull asking for a sync folder"
::   release.bat minor "New admin view"
:: Runs tests, bumps the version, builds dist, commits, tags and pushes.
:: Add --dry-run to build without committing.
node "%~dp0scripts\release.js" %*
if %errorlevel% neq 0 (
    echo.
    echo Release did NOT go out. See the message above.
)
pause
