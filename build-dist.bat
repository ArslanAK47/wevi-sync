@echo off
:: Rebuild dist\ (files, files.json manifest, installer zip) from the CURRENT version.
:: To publish an update to editors use release.bat instead.
node "%~dp0scripts\release.js" --build-only
pause
