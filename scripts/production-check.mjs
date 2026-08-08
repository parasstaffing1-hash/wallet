import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const packageJson = JSON.parse(read("package.json"));
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const capabilities = JSON.parse(read("src-tauri/capabilities/default.json"));
const workspaceConfig = read("pnpm-workspace.yaml");

function isAtLeastVersion(version, minimum) {
  const actual = version.split(".").map((part) => Number.parseInt(part, 10));
  return actual[0] > minimum[0]
    || (actual[0] === minimum[0] && actual[1] > minimum[1])
    || (actual[0] === minimum[0] && actual[1] === minimum[1] && actual[2] >= minimum[2]);
}

assert.equal(packageJson.private, true, "The app package must remain private.");
assert.ok(isAtLeastVersion(packageJson.dependencies.next, [15, 5, 21]), "Next.js must be on a patched release.");
assert.match(workspaceConfig, /postcss:\s*8\.5\.26/, "The patched PostCSS override is missing.");
assert.match(workspaceConfig, /sharp:\s*0\.35\.0/, "The patched Sharp override is missing.");
assert.equal(tauriConfig.app.withGlobalTauri, false, "Global Tauri APIs must stay disabled.");
assert.equal(tauriConfig.app.security.csp["default-src"], "'self' asset:");
assert.equal(tauriConfig.app.security.csp["style-src"], "'self'");
assert.equal(tauriConfig.bundle.windows.webviewInstallMode.type, "offlineInstaller");
assert.ok(capabilities.permissions.includes("stronghold:default"), "Stronghold permission is missing.");
assert.match(read("lib/secure-storage.ts"), /plugin-stronghold/);
assert.match(read("src-tauri/src/lib.rs"), /tauri_plugin_stronghold/);
assert.match(read("app/wallet/page.tsx"), /15 \* 60 \* 1000/);
assert.match(read("app/passwords/page.tsx"), /15 \* 60 \* 1000/);
assert.match(read("lib/auth.ts"), /MIN_ACCOUNT_PASSWORD_LENGTH = 12/);
assert.match(read("app/wallet/page.tsx"), /64 MB/);
assert.match(read("src-tauri/src/lib.rs"), /MAX_SCAN_DEPTH/);
assert.match(read("src-tauri/src/lib.rs"), /MAX_SCAN_DIRECTORIES/);

console.log("Production configuration checks passed.");
