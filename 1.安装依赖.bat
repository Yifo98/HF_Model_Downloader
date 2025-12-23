@echo off
setlocal
set "BASE_DIR=%~dp0"
set "VENV_DIR=%BASE_DIR%.venv"
if not exist "%VENV_DIR%\Scripts\python.exe" (
  python -m venv "%VENV_DIR%"
)
call "%VENV_DIR%\Scripts\python.exe" -m pip install --upgrade pip
call "%VENV_DIR%\Scripts\python.exe" -m pip install huggingface_hub requests send2trash
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to install dependencies. Check Python and pip.
  pause
)
endlocal

