@echo off
setlocal EnableExtensions

cd /d "%~dp0"

echo ==========================================
echo VaultFlow / Wallet - Windows Setup
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Install Node.js LTS from: https://nodejs.org/en/download
  echo Then rerun this setup.
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [INFO] pnpm not found. Trying to install pnpm globally via npm...
  where npm >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] npm not found. Install Node.js LTS with npm included.
    pause
    exit /b 1
  )
  npm install -g pnpm
  if errorlevel 1 (
    echo [ERROR] Failed to install pnpm. Open an elevated terminal and run: npm install -g pnpm
    pause
    exit /b 1
  )
)

echo [1/3] Installing dependencies...
pnpm install --ignore-scripts
if errorlevel 1 (
  echo [ERROR] Dependency install failed.
  pause
  exit /b 1
)

echo [2/3] Verifying build...
pnpm run build
if errorlevel 1 (
  echo [ERROR] Build check failed.
  pause
  exit /b 1
)

echo [3/3] Setup finished.
echo.
echo Next:
echo   - Start app:  npm run dev
echo   - Open: http://localhost:3000
echo.

set /p STARTAPP="Start app now? (Y/N): "
if /i "%STARTAPP%"=="Y" (
  npm run dev
)

pause
exit /b 0
