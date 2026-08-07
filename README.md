# VaultFlow (Dashboard + API Vault)

Recreated from scratch:

- Home: `/`
- API Wallet: `/wallet`

Quick start:

## One-setup for Windows (single downloadable file)

Download one file (`setup-wallet-windows.bat`) from the repo and run it on any Windows machine.

Usage:

1. If you are in the project folder, double-click `setup-wallet-windows.bat` for local setup.
2. Or run it with any folder path to install into a separate location.
3. The setup installs dependencies and runs a build check.
4. Start with `npm run dev` (or `pnpm run dev`) when ready and open `http://localhost:3000`.

If double-click does nothing, run from a terminal instead:

```bat
cd /d %USERPROFILE%\Downloads
setup-wallet-windows.bat
```

Or paste a one-liner to run directly (downloads latest setup and starts it):

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/parasstaffing1-hash/wallet/main/setup-wallet-windows.bat" -OutFile "$env:TEMP\setup-wallet-windows.bat"; Start-Process cmd.exe -ArgumentList '/c', "$env:TEMP\setup-wallet-windows.bat" -NoNewWindow
```

## Manual start (if you prefer)

1. `pnpm install`
2. `npm run dev`
3. Open `http://localhost:3000`

## Offline login

VaultFlow uses offline-first auth. Open the app first at `/auth` (or use the `Login` link in the header), create an account, then log in from the same browser. No backend or internet calls are used for authentication.

To launch quickly (legacy helper):

```powershell
./open-dashboard.ps1
```

## Native desktop app

The project includes a Tauri desktop shell in `src-tauri/`. It opens the wallet in its own Windows app window instead of a browser tab and loads the static UI locally for offline use.

Build the Windows installer with:

```powershell
npm install
npm run build
npx @tauri-apps/cli@2.11.4 build --ci
```

The installer is written to `src-tauri/target/release/bundle/nsis/`.
