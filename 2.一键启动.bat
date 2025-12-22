@echo off
setlocal
set "BASE_DIR=%~dp0"
set "VENV_DIR=%BASE_DIR%.venv"
if not exist "%VENV_DIR%\Scripts\pythonw.exe" (
  echo [ERROR] venv not found. Run the install script first.
  pause
  exit /b 1
)
start "" /b "%VENV_DIR%\Scripts\pythonw.exe" "%BASE_DIR%app.py"
endlocal

