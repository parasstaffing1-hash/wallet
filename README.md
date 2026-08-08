# Wallet · Secure API Vault

Wallet is a local-first Windows vault for project API keys, environment secrets, PEM/SSH material, and passwords. It is designed for people who want one simple place to keep credentials without sending them to a hosted backend.

## Download

Download the [Windows installer](https://github.com/parasstaffing1-hash/wallet/raw/main/Wallet-Desktop-Setup.exe) and verify its [SHA-256 checksum](https://github.com/parasstaffing1-hash/wallet/blob/main/Wallet-Desktop-Setup.exe.sha256) before sharing it.

The installer includes the offline WebView2 runtime, so a clean Windows machine does not need Node.js, pnpm, or a separate server. The current release is unsigned; configure the CI certificate secrets before public distribution to remove the SmartScreen warning.

## Product surface

- API Vault with project folders, search, favorites, notes, and one-click copy.
- Password Manager for website credentials with generated strong passwords.
- Folder scanning for `.env`, `.env.*`, JSON assignments, PEM, SSH, and common config files.
- Encrypted import/export, local account creation, automatic locking, and clipboard clearing.
- Offline-first operation: vault contents never leave the device.

## Build from source

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:production
pnpm audit:dependencies
pnpm exec tsc --noEmit
pnpm lint
pnpm test:crypto
pnpm build
pnpm desktop:build -- --ci
```

The installer is generated at `src-tauri/target/release/bundle/nsis/`. Local development uses `pnpm dev`; the native shell uses `pnpm desktop:dev` after `pnpm build`.

## Repository layout

| Path | Purpose |
| --- | --- |
| `app/` | Wallet, password manager, settings, and authentication UI |
| `lib/` | Encryption, Stronghold storage, authentication, and generators |
| `src-tauri/` | Native Windows shell, secure scanner, permissions, and CSP |
| `scripts/` | Production checks, crypto tests, and scale benchmarks |
| `.github/workflows/` | Audited Windows release pipeline |

Generated folders such as `node_modules/`, `.next/`, `out/`, and `src-tauri/target/` are intentionally ignored and are not part of the release source.

## Security model

- Desktop vault blobs are stored in Tauri Stronghold and protected by Argon2-derived snapshot keys.
- Payloads use AES-256-GCM with random IVs and PBKDF2-HMAC-SHA-256 with 310,000 iterations; legacy vaults are upgraded after unlock.
- The scanner skips symlinks, dependency/build folders, binary files, oversized files, deep trees, and oversized projects.
- The desktop CSP and native capability set are minimal. Backups remain encrypted and require the vault passwords to restore.
- Run `pnpm check:production`, `pnpm audit:dependencies`, and `pnpm stress:test -- --wallet 100000 --passwords 100000` before a release.

## Offline accounts

Account creation and login work without a server. The account password is never stored; only a salted PBKDF2 verifier and a short-lived local session are retained.
