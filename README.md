# Wallet

Wallet is an offline-first Windows desktop vault for project API keys, environment secrets, PEM/SSH material, and passwords. It has no hosted backend and does not send vault contents over the network.

## Release build

The Windows release is a single NSIS installer. It embeds the WebView2 runtime so a clean Windows machine can install without an internet connection.

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:production
pnpm exec tsc --noEmit
pnpm build
pnpm desktop:build -- --ci
```

The installer is generated at `src-tauri/target/release/bundle/nsis/`. The CI workflow also publishes a SHA-256 checksum for the installer.
The checked-in release artifact is `Wallet-Desktop-Setup.exe`; verify it against `Wallet-Desktop-Setup.exe.sha256` before sharing.

## Local development

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev
```

For the native shell:

```powershell
pnpm build
pnpm desktop:dev
```

## Security model

- On the Windows desktop build, encrypted wallet and password vault blobs are stored in Tauri Stronghold, protected by the vault password and Argon2-derived Stronghold snapshot keys.
- The vault payloads use AES-256-GCM with a unique random IV and PBKDF2-HMAC-SHA-256 (310,000 iterations) key derivation. Older 50,000-iteration vaults are upgraded after a successful unlock.
- Existing browser-only data is migrated into Stronghold the first time a desktop vault is unlocked. The browser build keeps its encrypted localStorage fallback for offline use.
- The app CSP is restrictive, native permissions are scoped to the main window, and the folder scanner skips symlinks, build/dependency folders, binary files, oversized files, and oversized projects.
- Backups remain encrypted blobs. Exporting or importing on desktop requires the relevant vault password; the app never exports plaintext secrets.

## Production checklist

Run `pnpm check:production` before shipping. For a release build, also run the stress benchmark with a representative dataset:

```powershell
pnpm stress:test -- --wallet 100000 --passwords 100000
```

The installer should be code-signed with the publisher's Windows Authenticode certificate before distribution. CI signs it automatically when the `WINDOWS_CERTIFICATE_BASE64` and `WINDOWS_CERTIFICATE_PASSWORD` repository secrets are configured. This repository does not contain a private signing certificate; the checked-in installer is therefore unsigned and may show a Windows SmartScreen warning until you publish a signed build.

## Offline account

Account creation and login work without a server or internet connection. The account password is never stored; only a salted PBKDF2 verifier and a short-lived local session are retained.
