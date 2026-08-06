Set-Location (Resolve-Path "C:\Users\HP\Documents\N8N\career-intelligence-platform")

if (-not (Test-Path "node_modules\\.pnpm")) {
  Write-Host "Installing dependencies with pnpm..."
  pnpm install
}

Write-Host "Opening VaultFlow at http://localhost:3000"
npm run dev -- --hostname 127.0.0.1 --port 3000
