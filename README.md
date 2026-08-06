# VaultFlow (Dashboard + API Vault)

Recreated from scratch:

- Home: `/`
- API Wallet: `/wallet`

Run:

1. `pnpm install`
2. `npm run dev`
3. Open `http://localhost:3000`

## Offline login

VaultFlow uses offline-first auth. Open the app first at `/auth` (or use the `Login` link in the header), create an account, then log in from the same browser. No backend or internet calls are used for authentication.

To launch quickly, run:

```powershell
./open-dashboard.ps1
```
