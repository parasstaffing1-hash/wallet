@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "APP_NAME=wallet"
set "REPO_ZIP=https://github.com/parasstaffing1-hash/wallet/archive/refs/heads/main.zip"
set "START_URL=http://localhost:3000"

set "WORKDIR="
set "RUN_AFTER_INSTALL=1"

set "ARG1=%~1"
set "ARG2=%~2"

if /I "%ARG1%"=="--no-run" set "RUN_AFTER_INSTALL=0"
if /I "%ARG1%"=="-n" set "RUN_AFTER_INSTALL=0"
if /I "%ARG2%"=="--no-run" set "RUN_AFTER_INSTALL=0"
if /I "%ARG2%"=="-n" set "RUN_AFTER_INSTALL=0"

if /I not "%ARG1:~0,1%"=="" (
  if /I not "%ARG1:~0,1%"=="-" (
    if /I not "%ARG1:~0,1%"=="/" (
      set "WORKDIR=%ARG1%"
    )
  )
)

set "INSTALL_MODE=remote"
set "PM="

call :header
call :check_node
if errorlevel 1 goto :eof

if defined WORKDIR (
  if exist "%WORKDIR%\package.json" set "INSTALL_MODE=local"
)

if not defined WORKDIR (
  if exist "%~dp0package.json" (
    set "WORKDIR=%~dp0"
    set "INSTALL_MODE=local"
  )
)

if not defined WORKDIR (
  if exist "%CD%\package.json" (
    set "WORKDIR=%CD%"
    set "INSTALL_MODE=local"
  )
)

if /I "%INSTALL_MODE%"=="remote" (
  if not defined WORKDIR set "WORKDIR=%USERPROFILE%\Downloads\%APP_NAME%\%APP_NAME%-%RANDOM%%RANDOM%"
)

if /I "%INSTALL_MODE%"=="remote" (
  call :download_project
  if errorlevel 1 goto done
)

if /I "%INSTALL_MODE%"=="local" (
  if not exist "%WORKDIR%\package.json" (
    echo [Error] No package.json found in "%WORKDIR%".
    goto fail
  )
)

if not exist "%WORKDIR%" mkdir "%WORKDIR%" >nul

call :set_pm
if errorlevel 1 goto fail

pushd "%WORKDIR%"
echo.
echo [Step] Installing dependencies (%PM%)...
if /I "%PM%"=="pnpm" (
  call %PM% install --ignore-scripts
) else (
  call %PM% install --ignore-scripts
)
if errorlevel 1 (
  popd
  goto install_failed
)
echo.
echo [Step] Verifying build...
call %PM% run build
if errorlevel 1 (
  popd
  goto build_failed
)
popd

echo.
echo [Done] Wallet installed at "%WORKDIR%".
echo.

if "%RUN_AFTER_INSTALL%"=="1" (
  echo Starting app now...
  start "" cmd /k "cd /d "%WORKDIR%" && %PM% run dev"
  echo Open %START_URL% in your browser once the dev server is ready.
) else (
  echo To start: cd /d "%WORKDIR%" && %PM% run dev
  echo Then open %START_URL%
)

goto done

:download_project
set "TMP_ROOT=%TEMP%\%APP_NAME%-setup-%RANDOM%%RANDOM%"
set "TMP_ZIP=%TMP_ROOT%\project.zip"
set "TMP_EXTRACT=%TMP_ROOT%\extract"
set "EXTRACT_DIR="

if exist "%TMP_ROOT%\." (
  rmdir /S /Q "%TMP_ROOT%" >nul 2>&1
)

mkdir "%TMP_ROOT%" >nul 2>&1 || goto download_error
mkdir "%TMP_EXTRACT%" >nul 2>&1 || goto download_error

echo [Step] Downloading wallet source from GitHub...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri '%REPO_ZIP%' -OutFile '%TMP_ZIP%'" >nul 2>&1
if errorlevel 1 goto download_error

if not exist "%TMP_ZIP%" goto download_error

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Expand-Archive -Path '%TMP_ZIP%' -DestinationPath '%TMP_EXTRACT%' -Force" >nul 2>&1
if errorlevel 1 goto download_error

for /D %%F in ("%TMP_EXTRACT%\*") do (
  if exist "%%F\package.json" (
    set "EXTRACT_DIR=%%~fF"
    goto found_extract
  )
)

:found_extract
if not defined EXTRACT_DIR goto download_error

echo [Step] Copying files to "%WORKDIR%"...
mkdir "%WORKDIR%" >nul 2>&1 || goto download_error
robocopy "%EXTRACT_DIR%" "%WORKDIR%" /E /COPY:DAT /R:2 /W:2 >nul
if errorlevel 8 goto download_error

rmdir /S /Q "%TMP_ROOT%" >nul 2>&1
echo [Done] Download and extract complete.
set "INSTALL_MODE=local"
exit /b 0

:header
echo.
echo =========================================
echo   Wallet App - Single File Windows Setup
echo =========================================
echo.
exit /b 0

:check_node
where node >nul 2>nul
if errorlevel 1 (
  echo [Error] Node.js is required but not found in PATH.
  echo Install Node.js from: https://nodejs.org
  exit /b 1
)
exit /b 0

:set_pm
where pnpm >nul 2>nul
if errorlevel 1 (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo [Error] npm is not available in PATH.
    exit /b 1
  )
  set "PM=npm"
) else (
  set "PM=pnpm"
)
exit /b 0

:download_error
echo.
echo [Error] Could not download or unpack GitHub project.
if exist "%TMP_ROOT%" rmdir /S /Q "%TMP_ROOT%" >nul 2>&1
exit /b 1

:install_failed
echo.
echo [Error] Dependency installation failed. Check your network and rerun.
goto fail

:build_failed
echo.
echo [Error] Build failed.
goto fail

:fail
exit /b 1

:done
echo.
echo Finished.
exit /b 0
