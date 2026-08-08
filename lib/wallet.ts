import { hasSecureValue, isDesktopApp, readSecureValue, removeSecureValue, writeSecureValue } from "./secure-storage";

export type WalletItemKind = "api-key" | "login" | "secure-note" | "ssh-key" | "certificate" | "token";

export interface WalletSecret {
  id: string;
  kind: WalletItemKind;
  folder: string;
  project: string;
  app: string;
  name: string;
  value: string;
  username?: string;
  website?: string;
  expiresAt?: string;
  tags?: string[];
  favorite?: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface EncryptedWallet {
  version: number;
  iterations?: number;
  salt: string;
  iv: string;
  data: string;
}

const WALLET_STORAGE_KEY = "myapp-wallet:v1";
const WALLET_PRESENT_KEY = "myapp-wallet:present";
const WALLET_FOLDERS_STORAGE_KEY = "myapp-wallet-folders:v1";
const SECURE_STORAGE = {
  storageKey: WALLET_STORAGE_KEY,
  markerKey: WALLET_PRESENT_KEY,
  clientName: "wallet",
  recordKey: "encrypted-wallet",
  snapshotName: "wallet-vault",
} as const;
const ENCRYPTION_VERSION = 1;
const LEGACY_PBKDF2_ITERATIONS = 50000;
const PBKDF2_ITERATIONS = 310000;
const BASE64_CHUNK_SIZE = 8192;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type CachedWalletKey = {
  password: string;
  salt: string;
  key: CryptoKey;
};

let cachedKey: CachedWalletKey | null = null;

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let output = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
    output += String.fromCharCode(...chunk);
  }
  return btoa(output);
}

export function hasStoredWallet(): boolean {
  return hasSecureValue(SECURE_STORAGE);
}

export async function readWalletBackup(password: string): Promise<string | null> {
  return readSecureValue(SECURE_STORAGE, password);
}

export async function writeWalletBackup(password: string, value: string | null): Promise<void> {
  if (value === null) {
    await removeSecureValue(SECURE_STORAGE, password);
    return;
  }
  await writeSecureValue(SECURE_STORAGE, password, value);
}

export function loadWalletFolders(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(WALLET_FOLDERS_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return Array.from(new Set(parsed.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))).sort(
      (a, b) => a.localeCompare(b)
    );
  } catch {
    return [];
  }
}

export function saveWalletFolders(folders: string[]): void {
  if (typeof window === "undefined") {
    return;
  }
  const normalized = Array.from(new Set(folders.map((folder) => folder.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  window.localStorage.setItem(WALLET_FOLDERS_STORAGE_KEY, JSON.stringify(normalized));
}

function getSaltAndBlob(rawValue: string | null) {
  let blob: EncryptedWallet | null = null;
  try {
    blob = rawValue ? (JSON.parse(rawValue) as EncryptedWallet) : null;
  } catch {
    blob = null;
  }
  if (!blob?.salt || !blob.iv || !blob.data) {
    return { blob: null, salt: null };
  }
  return { blob, salt: base64ToBytes(blob.salt) };
}

function getCachedKey(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const saltFingerprint = bytesToBase64(salt);
  const cacheFingerprint = `${saltFingerprint}:${iterations}`;
  if (cachedKey && cachedKey.password === password && cachedKey.salt === cacheFingerprint) {
    return Promise.resolve(cachedKey.key);
  }

  return window.crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  ).then((baseKey) =>
    window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256",
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    )
  ).then((key) => {
    cachedKey = { password, salt: cacheFingerprint, key };
    return key;
  });
}

export function clearWalletKeyCache() {
  cachedKey = null;
}

export async function loadWallet(password: string): Promise<WalletSecret[]> {
  if (typeof window === "undefined") {
    return [];
  }

  let rawValue: string | null;
  try {
    rawValue = await readSecureValue(SECURE_STORAGE, password);
  } catch {
    throw new Error("Invalid password or inaccessible secure wallet storage.");
  }
  if (!rawValue) {
    return [];
  }
  let blob: EncryptedWallet;
  try {
    blob = JSON.parse(rawValue) as EncryptedWallet;
  } catch {
    throw new Error("Wallet data is corrupted.");
  }
  if (!blob.salt || !blob.iv || !blob.data) {
    throw new Error("Wallet data is corrupted.");
  }

  const salt = base64ToBytes(blob.salt);
  const iv = base64ToBytes(blob.iv);
  const cipherText = base64ToBytes(blob.data);
  const key = await getCachedKey(password, salt, blob.iterations ?? LEGACY_PBKDF2_ITERATIONS);

  try {
    const plainText = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherText);
    const decoded = decoder.decode(new Uint8Array(plainText));
    if (decoded.trim() === "") {
      if (isDesktopApp() && window.localStorage.getItem(WALLET_STORAGE_KEY) !== null) {
        await writeSecureValue(SECURE_STORAGE, password, rawValue);
      }
      return [];
    }
    const secrets = JSON.parse(decoded) as Array<WalletSecret & { folder?: string }>;
    if (!Array.isArray(secrets)) {
      if (isDesktopApp() && window.localStorage.getItem(WALLET_STORAGE_KEY) !== null) {
        await writeSecureValue(SECURE_STORAGE, password, rawValue);
      }
      return [];
    }
    const normalizedSecrets = secrets.map((secret) => ({
      ...secret,
      kind: secret.kind ?? "api-key",
      folder: secret.folder?.trim() || secret.project?.trim() || "General",
    }));
    const normalized = normalizedSecrets.sort((a, b) => {
      const aTime = Date.parse(a.updatedAt);
      const bTime = Date.parse(b.updatedAt);
      if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) {
        return 0;
      }
      return bTime - aTime;
    });
    if (isDesktopApp() && window.localStorage.getItem(WALLET_STORAGE_KEY) !== null) {
      await writeSecureValue(SECURE_STORAGE, password, rawValue);
    }
    return normalized;
  } catch {
    clearWalletKeyCache();
    throw new Error("Invalid password or corrupted wallet file.");
  }
}

export async function saveWallet(password: string, secrets: WalletSecret[]): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const existing = getSaltAndBlob(await readSecureValue(SECURE_STORAGE, password));
  if (existing.blob && existing.salt) {
    try {
      const existingKey = await getCachedKey(password, existing.salt, existing.blob.iterations ?? LEGACY_PBKDF2_ITERATIONS);
      await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(existing.blob.iv) },
        existingKey,
        base64ToBytes(existing.blob.data)
      );
    } catch {
      clearWalletKeyCache();
      throw new Error("Invalid password or corrupted wallet file.");
    }
  }
  const salt = existing.salt ?? window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await getCachedKey(password, salt);

  const encoded = encoder.encode(JSON.stringify(secrets));
  const cipherText = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  const blob: EncryptedWallet = {
    version: ENCRYPTION_VERSION,
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(new Uint8Array(iv)),
    data: bytesToBase64(new Uint8Array(cipherText)),
  };

  await writeSecureValue(SECURE_STORAGE, password, JSON.stringify(blob));
}

export async function clearWallet(password?: string): Promise<void> {
  clearWalletKeyCache();
  await removeSecureValue(SECURE_STORAGE, password);
  if (typeof window !== "undefined") window.localStorage.removeItem(WALLET_FOLDERS_STORAGE_KEY);
}
