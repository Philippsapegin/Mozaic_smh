@echo off
chcp 65001 >nul
if exist "%~dp0Установить Мозаику.exe" (
  start "" "%~dp0Установить Мозаику.exe"
) else (
  start "" "https://github.com/Philippsapegin/Mozaic_smh/releases/latest/download/Mozaic-setup.exe"
)
