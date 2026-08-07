import { webcrypto } from "crypto";

const { subtle } = webcrypto;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PASSPHRASE = "vaultflow-stress-passphrase";
const PBKDF2_ITERATIONS = 50000;

function parseArg(name, defaultValue) {
  const key = `--${name}`;
  const argv = process.argv;
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === key && i + 1 < argv.length) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        return Number.parseInt(next, 10);
      }
    }
    if (item.startsWith(`${key}=`)) {
      return Number.parseInt(item.split("=")[1], 10);
    }
  }
  return defaultValue;
}

function toMb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

function nowMs() {
  return performance.now();
}

async function runTimed(label, fn) {
  const started = nowMs();
  const value = await fn();
  const elapsed = nowMs() - started;
  return { label, ms: elapsed, value };
}

function bytesForText(value) {
  return encoder.encode(value).byteLength;
}

async function deriveKey(password, salt) {
  const baseKey = await subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function benchmarkEncryption(label, payload) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(PASSPHRASE, salt);
  const payloadText = encoder.encode(JSON.stringify(payload));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));

  const encrypted = await subtle.encrypt({ name: "AES-GCM", iv }, key, payloadText);
  const encryptedBytes = encrypted.byteLength;
  const decryptRounds = await runTimed(`${label}:decrypt`, async () => {
    const decrypted = await subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
    return decoder.decode(new Uint8Array(decrypted));
  });
  const parsed = JSON.parse(decryptRounds.value);

  return {
    encryptedMb: toMb(encryptedBytes),
    plainMb: toMb(payloadText.byteLength),
    encryptMs: "n/a",
    decryptMs: decryptRounds.ms,
    decryptedCount: Array.isArray(parsed) ? parsed.length : null,
  };
}

async function benchmarkWallet(count) {
  const start = nowMs();
  const now = new Date().toISOString();
  const items = new Array(count);
  for (let i = 0; i < count; i += 1) {
    items[i] = {
      id: `w-${i}`,
      project: `project-${i % 100}`,
      app: `app-${i % 25}`,
      name: `API_KEY_${i}`,
      value: `sk_live_${String(i).padStart(8, "0")}`,
      notes: i % 9 === 0 ? "rotation-note" : "",
      createdAt: now,
      updatedAt: now,
    };
  }
  const buildMs = nowMs() - start;

  const filterByProject = await runTimed("wallet:filter-project", () => {
    let total = 0;
    const needle = "project-7";
    for (const item of items) {
      if (item.project === needle) {
        total += 1;
      }
    }
    return total;
  });

  const filterByName = await runTimed("wallet:search-name", () => {
    let total = 0;
    const needle = `API_KEY_${count - 1}`;
    for (const item of items) {
      if (item.name.includes(needle)) {
        total += 1;
      }
    }
    return total;
  });

  const snapshot = await runTimed("wallet:json-size", () => {
    const json = JSON.stringify(items);
    return json.length;
  });

  const encryption = await runTimed("wallet:encrypt-decrypt", async () => {
    const payloadText = encoder.encode(JSON.stringify(items));
    const salt = webcrypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(PASSPHRASE, salt);
    const iv = webcrypto.getRandomValues(new Uint8Array(12));

    const encrypted = await subtle.encrypt({ name: "AES-GCM", iv }, key, payloadText);
    const encryptedBytes = encrypted.byteLength;
    const decryptStart = nowMs();
    const decrypted = await subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
    const plainText = decoder.decode(new Uint8Array(decrypted));
    const parsed = JSON.parse(plainText);

    return {
      encryptMs: toMb(payloadText.byteLength),
      encryptedMb: toMb(encryptedBytes),
      plainMb: toMb(payloadText.byteLength),
      decryptMs: nowMs() - decryptStart,
      plainEntries: Array.isArray(parsed) ? parsed.length : 0,
    };
  });

  return {
    count,
    buildMs,
    filterByProjectMs: filterByProject.ms,
    filterByNameMs: filterByName.ms,
    filterMatchesProject: filterByProject.value,
    filterMatchesName: filterByName.value,
    jsonLength: snapshot.value,
    jsonLengthMb: toMb(snapshot.value),
    plainMb: encryption.value.plainMb,
    encryptedMb: encryption.value.encryptedMb,
    decryptMs: encryption.value.decryptMs,
  };
}

async function benchmarkPasswords(count) {
  const start = nowMs();
  const now = new Date().toISOString();
  const items = new Array(count);
  for (let i = 0; i < count; i += 1) {
    items[i] = {
      id: `p-${i}`,
      title: `service-${i % 120}`,
      username: `user-${i % 1000}`,
      password: `pwd_${String(i).padStart(10, "0")}`,
      website: `https://service-${i % 120}.example.com`,
      notes: i % 11 === 0 ? "team-account" : "",
      createdAt: now,
      updatedAt: now,
    };
  }
  const buildMs = nowMs() - start;

  const filterByTitle = await runTimed("passwords:filter-title", () => {
    let total = 0;
    const needle = "service-7";
    for (const item of items) {
      if (item.title === needle) {
        total += 1;
      }
    }
    return total;
  });

  const filterByUser = await runTimed("passwords:search-username", () => {
    let total = 0;
    const needle = `user-${count - 1}`;
    for (const item of items) {
      if (item.username.includes(needle)) {
        total += 1;
      }
    }
    return total;
  });

  const snapshot = await runTimed("passwords:json-size", () => {
    const json = JSON.stringify(items);
    return json.length;
  });

  const encryption = await runTimed("passwords:encrypt-decrypt", async () => {
    const payloadText = encoder.encode(JSON.stringify(items));
    const salt = webcrypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(PASSPHRASE, salt);
    const iv = webcrypto.getRandomValues(new Uint8Array(12));

    const encrypted = await subtle.encrypt({ name: "AES-GCM", iv }, key, payloadText);
    const encryptedBytes = encrypted.byteLength;
    const decryptStart = nowMs();
    const decrypted = await subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
    const plainText = decoder.decode(new Uint8Array(decrypted));
    const parsed = JSON.parse(plainText);

    return {
      encryptedMb: toMb(encryptedBytes),
      plainMb: toMb(payloadText.byteLength),
      decryptMs: nowMs() - decryptStart,
      plainEntries: Array.isArray(parsed) ? parsed.length : 0,
    };
  });

  return {
    count,
    buildMs,
    filterByTitleMs: filterByTitle.ms,
    filterByUserMs: filterByUser.ms,
    filterMatchesTitle: filterByTitle.value,
    filterMatchesUser: filterByUser.value,
    jsonLength: snapshot.value,
    jsonLengthMb: toMb(snapshot.value),
    plainMb: encryption.value.plainMb,
    encryptedMb: encryption.value.encryptedMb,
    decryptMs: encryption.value.decryptMs,
  };
}

async function main() {
  const walletCount = parseArg("wallet", 1_000_000);
  const passwordCount = parseArg("passwords", 1_000_000);

  console.log(`VaultFlow Stress Test - Wallet=${walletCount.toLocaleString()} Passwords=${passwordCount.toLocaleString()}`);
  console.log(`Node ${process.version} | Platform ${process.platform}-${process.arch}\n`);

  const wallet = await benchmarkWallet(walletCount);
  console.log("WALLET RESULTS", JSON.stringify(wallet, null, 2));

  if (global.gc) {
    global.gc();
  }

  const passwords = await benchmarkPasswords(passwordCount);
  console.log("PASSWORD RESULTS", JSON.stringify(passwords, null, 2));

  console.log("\nInterpretation:");
  console.log("- This benchmark validates local processing speed and memory behavior at scale.");
  console.log("- Rendering 1,000,000 rows in the current UI will not be practical in one page.");
  console.log("- Browser localStorage for encrypted vaults will also likely hit size limits near this scale.");
}

main().catch((error) => {
  console.error("Stress test failed:", error);
  process.exitCode = 1;
});
