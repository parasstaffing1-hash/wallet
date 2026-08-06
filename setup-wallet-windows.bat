@echo off
setlocal EnableExtensions EnableDelayedExpansion

title VaultFlow - Local / Download Windows Setup

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "REPO_OWNER=parasstaffing1-hash"
set "REPO_NAME=wallet"
set "REPO_BRANCH=main"
set "REPO_ZIP_URL=https://github.com/%REPO_OWNER%/%REPO_NAME%/archive/refs/heads/%REPO_BRANCH%.zip"
set "WORK_DIR=%TEMP%\vaultflow-setup"
set "ZIP_PATH=%WORK_DIR%\%REPO_NAME%.zip"
set "EXTRACT_PATH=%WORK_DIR%\extract"

set "RUN_LOCAL=0"
if exist "%SCRIPT_DIR%\package.json" set "RUN_LOCAL=1"

if "%~1"=="" (
  if "%RUN_LOCAL%"=="1" set "TARGET_DIR=%SCRIPT_DIR%"
  if not "%RUN_LOCAL%"=="1" set "TARGET_DIR=%USERPROFILE%\Documents\wallet"
) else (
  set "TARGET_DIR=%~1"
)
if /I "%TARGET_DIR%"=="." set "TARGET_DIR=%CD%"

if "%RUN_LOCAL%"=="1" (
  echo Running in local mode.
) else (
  echo Running in download mode.
)
echo Setup file: %SCRIPT_DIR%
echo Target folder: %TARGET_DIR%
echo.
echo This installer will install dependencies and run a build check.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Install from https://nodejs.org/en/download and rerun.
  pause
  exit /b 1
)

if not exist "%TEMP%" set "TEMP=%USERPROFILE%\AppData\Local\Temp"
where powershell >nul 2>nul
if errorlevel 1 (
  echo [ERROR] PowerShell is required and was not found.
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [WARN] pnpm not found.
  where npm >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Neither pnpm nor npm is available on PATH.
    echo Install Node.js LTS (includes npm) and rerun.
    pause
    exit /b 1
  )
)

if "%RUN_LOCAL%"=="1" goto LocalFlow
goto DownloadFlow

:LocalFlow
if /I "%TARGET_DIR%"=="%SCRIPT_DIR%" (
  echo [1/3] Using local folder directly.
) else (
  echo [1/3] Copying local files to:
  echo   %TARGET_DIR%
  if exist "%TARGET_DIR%" rmdir /s /q "%TARGET_DIR%" >nul 2>&1
  mkdir "%TARGET_DIR%" >nul
  xcopy "%SCRIPT_DIR%\*" "%TARGET_DIR%\" /E /I /Y >nul
  if errorlevel 1 (
    echo [ERROR] Failed to copy files to %TARGET_DIR%.
    pause
    exit /b 1
  )
)
goto InstallAndBuild

:DownloadFlow
if exist "%WORK_DIR%" rmdir /s /q "%WORK_DIR%" >nul 2>&1
mkdir "%WORK_DIR%" >nul
mkdir "%EXTRACT_PATH%" >nul

echo [1/5] Downloading latest source from GitHub...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%REPO_ZIP_URL%' -OutFile '%ZIP_PATH%'"
if errorlevel 1 (
  echo [ERROR] Download failed.
  pause
  exit /b 1
)

echo [2/5] Extracting archive...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%ZIP_PATH%' -DestinationPath '%EXTRACT_PATH%' -Force"
if errorlevel 1 (
  echo [ERROR] Extract failed.
  pause
  exit 1
)

set "SOURCE_DIR="
for /f "delims=" %%D in ('dir /ad /b "%EXTRACT_PATH%\%REPO_NAME%-*%REPO_BRANCH%"') do set "SOURCE_DIR=%EXTRACT_PATH%\%%D"
if not defined SOURCE_DIR (
  echo [ERROR] Could not find source folder in download.
  pause
  exit /b 1
)

echo [3/5] Copying downloaded project...
if exist "%TARGET_DIR%" rmdir /s /q "%TARGET_DIR%" >nul 2>&1
mkdir "%TARGET_DIR%" >nul
xcopy "%SOURCE_DIR%\*" "%TARGET_DIR%\" /E /I /Y >nul
if errorlevel 1 (
  echo [ERROR] Copy after download failed.
  pause
  exit /b 1
)
goto InstallAndBuild

:InstallAndBuild
if not exist "%TARGET_DIR%\package.json" (
  echo [ERROR] package.json not found: %TARGET_DIR%
  pause
  exit /b 1
)

pushd "%TARGET_DIR%"
if exist pnpm-lock.yaml (
  set "PM=pnpm"
) else (
  set "PM=npm"
)

if "%RUN_LOCAL%"=="1" (
  echo [2/3] Installing dependencies using %PM%...
) else (
  echo [4/5] Installing dependencies using %PM%...
)
%PM% install --ignore-scripts
if errorlevel 1 (
  echo [ERROR] Dependency installation failed.
  popd
  pause
  exit /b 1
)

if "%RUN_LOCAL%"=="1" (
  echo [3/3] Running build check...
) else (
  echo [5/5] Running build check...
)
%PM% run build
if errorlevel 1 (
  echo [ERROR] Build check failed.
  popd
  pause
  exit /b 1
)

echo.
echo Setup complete.
echo App folder: %TARGET_DIR%
echo Open: http://localhost:3000
echo.
set /p START_APP="Start app now? (Y/N): "
if /I "%START_APP%"=="Y" (
  echo Starting dev server...
  %PM% dev
)

popd
if "%RUN_LOCAL%"=="0" rmdir /s /q "%WORK_DIR%" >nul 2>&1
pause
exit /b 0
