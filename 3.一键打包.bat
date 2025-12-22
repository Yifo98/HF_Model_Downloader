@echo off
setlocal
set "BASE_DIR=%~dp0"
set "VENV_DIR=%BASE_DIR%.venv"
set "TEMP_APPDATA=%BASE_DIR%_build_appdata"
set "DIST_DIR=%BASE_DIR%dist"
set "APP_NAME=HF_Model_Downloader"
set "ZIP_PATH=%BASE_DIR%%APP_NAME%.zip"
set "SPEC_PATH=%BASE_DIR%%APP_NAME%.spec"
if not exist "%TEMP_APPDATA%" (
  mkdir "%TEMP_APPDATA%"
)
set "APPDATA=%TEMP_APPDATA%"
set "LOCALAPPDATA=%TEMP_APPDATA%"
if not exist "%VENV_DIR%\Scripts\python.exe" (
  python -m venv "%VENV_DIR%"
)
call "%VENV_DIR%\Scripts\python.exe" -m pip install --upgrade pip
call "%VENV_DIR%\Scripts\python.exe" -m pip install pyinstaller
call "%VENV_DIR%\Scripts\pyinstaller.exe" --clean --noconsole --onefile --name %APP_NAME% "%BASE_DIR%app.py"
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to build EXE. Check Python and PyInstaller.
  pause
  endlocal
  exit /b 1
)
if exist "%ZIP_PATH%" del /f /q "%ZIP_PATH%"
powershell -NoProfile -Command "Compress-Archive -Path \"%DIST_DIR%\%APP_NAME%.exe\",\"%BASE_DIR%README.md\" -DestinationPath \"%ZIP_PATH%\""
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to create zip package.
  pause
  endlocal
  exit /b 1
)
if exist "%DIST_DIR%" rmdir /s /q "%DIST_DIR%"
if exist "%BASE_DIR%build" rmdir /s /q "%BASE_DIR%build"
if exist "%BASE_DIR%_build_appdata" rmdir /s /q "%BASE_DIR%_build_appdata"
if exist "%SPEC_PATH%" del /f /q "%SPEC_PATH%"
endlocal

