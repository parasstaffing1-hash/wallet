# VaultFlow (Dashboard + API Vault)

Recreated from scratch:

- Home: `/`
- API Wallet: `/wallet`

Quick start:

## One-setup for Windows (single downloadable file)

Download one file (`setup-wallet-windows.bat`) from the repo and run it on any Windows machine.

Usage:

1. Double-click `setup-wallet-windows.bat`.
2. Choose a target folder (or press Enter for default).
3. The installer downloads the latest project, installs dependencies, and runs a build check.
4. Start with `pnpm dev` when ready and open `http://localhost:3000`.

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
