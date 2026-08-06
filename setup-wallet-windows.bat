@echo off
setlocal EnableExtensions EnableDelayedExpansion

:: Force launch in a real cmd window (for users who double-click from Explorer).
if "%~f0"=="" (
  echo [ERROR] Cannot run this file directly from this shell.
  exit /b 1
)

title VaultFlow - Single Windows Setup (Downloads from GitHub)

set "REPO_OWNER=parasstaffing1-hash"
set "REPO_NAME=wallet"
set "REPO_BRANCH=main"
set "REPO_ZIP_URL=https://github.com/%REPO_OWNER%/%REPO_NAME%/archive/refs/heads/%REPO_BRANCH%.zip"
set "WORK_DIR=%TEMP%\vaultflow-setup"
set "ZIP_PATH=%WORK_DIR%\%REPO_NAME%.zip"
set "EXTRACT_PATH=%WORK_DIR%\extract"

if "%~1"=="" (
  set "TARGET_DIR=%USERPROFILE%\Documents\wallet"
) else (
  set "TARGET_DIR=%~1"
)

if not exist "%TEMP%" set "TEMP=%USERPROFILE%\AppData\Local\Temp"

echo ==============================================
echo VaultFlow / Wallet - One-click Windows setup
echo ==============================================
echo.
echo This installer will:
echo   - Download the latest project from GitHub
echo   - Install dependencies
echo   - Run a build check
echo.
echo Default install folder:
echo   %TARGET_DIR%
echo.
set /p INPUT_TARGET="Press Enter to use default, or type custom folder: "
if defined INPUT_TARGET (
  if not "%INPUT_TARGET%"=="" (
    set "TARGET_DIR=%INPUT_TARGET%"
  )
)
if /I "%INPUT_TARGET%"=="." set "TARGET_DIR=%CD%"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Install from https://nodejs.org/en/download and rerun.
  pause
  exit /b 1
)

where powershell >nul 2>nul
if errorlevel 1 (
  echo [ERROR] PowerShell is required and was not found.
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [INFO] pnpm not found. Installing with npm...
  where npm >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] npm is not available. Install Node.js LTS (includes npm).
    pause
    exit /b 1
  )
  npm install -g pnpm
  if errorlevel 1 (
    echo [ERROR] pnpm install failed. Run: npm install -g pnpm
    pause
    exit /b 1
  )
)

if exist "%WORK_DIR%" rmdir /s /q "%WORK_DIR%" >nul 2>&1
mkdir "%WORK_DIR%" >nul
mkdir "%EXTRACT_PATH%" >nul

echo.
echo [1/5] Downloading latest source from GitHub...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%REPO_ZIP_URL%' -OutFile '%ZIP_PATH%'"
if errorlevel 1 (
  echo [ERROR] Failed to download project archive.
  pause
  exit /b 1
)

echo [2/5] Extracting archive...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Expand-Archive -Path '%ZIP_PATH%' -DestinationPath '%EXTRACT_PATH%' -Force"
if errorlevel 1 (
  echo [ERROR] Failed to extract archive.
  pause
  exit /b 1
)

for /f "delims=" %%D in ('dir /ad /b "%EXTRACT_PATH%\%REPO_NAME%-*%REPO_BRANCH%"') do (
  set "SOURCE_DIR=%EXTRACT_PATH%\%%D"
)
if not defined SOURCE_DIR (
  for /f "delims=" %%D in ('dir /ad /b "%EXTRACT_PATH%\*"') do (
    set "SOURCE_DIR=%EXTRACT_PATH%\%%D"
    goto SourceFound
  )
)
:SourceFound

if not defined SOURCE_DIR (
  echo [ERROR] Could not locate extracted source folder.
  pause
  exit /b 1
)

echo [3/5] Copying project to target folder...
if exist "%TARGET_DIR%" rmdir /s /q "%TARGET_DIR%" >nul 2>&1
mkdir "%TARGET_DIR%" >nul
xcopy "%SOURCE_DIR%\*" "%TARGET_DIR%\" /E /I /Y >nul
if errorlevel 1 (
  echo [ERROR] Failed to copy files to "%TARGET_DIR%".
  pause
  exit /b 1
)

pushd "%TARGET_DIR%"

echo [4/5] Installing dependencies...
pnpm install --ignore-scripts
if errorlevel 1 (
  echo [ERROR] Dependency installation failed.
  popd
  pause
  exit /b 1
)

echo [5/5] Running build check...
pnpm run build
if errorlevel 1 (
  echo [ERROR] Build check failed. Open setup output for details.
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
  pnpm dev
)

popd
rmdir /s /q "%WORK_DIR%" >nul 2>&1
pause
exit /b 0
