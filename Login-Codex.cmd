@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\login.ps1" -Provider codex
if errorlevel 1 pause
