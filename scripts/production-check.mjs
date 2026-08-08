import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const packageJson = JSON.parse(read("package.json"));
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const capabilities = JSON.parse(read("src-tauri/capabilities/default.json"));

assert.equal(packageJson.private, true, "The app package must remain private.");
assert.notEqual(packageJson.dependencies.next, "14.2.16", "The vulnerable Next.js version is still configured.");
assert.equal(tauriConfig.app.security.csp["default-src"], "'self' asset:");
assert.equal(tauriConfig.bundle.windows.webviewInstallMode.type, "offlineInstaller");
assert.ok(capabilities.permissions.includes("stronghold:default"), "Stronghold permission is missing.");
assert.match(read("lib/secure-storage.ts"), /plugin-stronghold/);
assert.match(read("src-tauri/src/lib.rs"), /tauri_plugin_stronghold/);

console.log("Production configuration checks passed.");
