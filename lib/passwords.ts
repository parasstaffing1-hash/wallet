import { hasSecureValue, isDesktopApp, readSecureValue, removeSecureValue, writeSecureValue } from "./secure-storage";

export interface PasswordEntry {
  id: string;
  title: string;
  username: string;
  password: string;
  website?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface EncryptedPasswordVault {
  version: number;
  iterations?: number;
  salt: string;
  iv: string;
  data: string;
}

const PASSWORDS_STORAGE_KEY = "vaultflow-passwords:v1";
const PASSWORDS_PRESENT_KEY = "vaultflow-passwords:present";
const SECURE_STORAGE = {
  storageKey: PASSWORDS_STORAGE_KEY,
  markerKey: PASSWORDS_PRESENT_KEY,
  clientName: "passwords",
  recordKey: "encrypted-passwords",
  snapshotName: "password-vault",
} as const;
const PASSWORD_ENCRYPTION_VERSION = 1;
const LEGACY_PBKDF2_ITERATIONS = 50000;
const PBKDF2_ITERATIONS = 310000;
const BASE64_CHUNK_SIZE = 8192;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type CachedPasswordKey = {
  password: string;
  salt: string;
  key: CryptoKey;
};

let cachedKey: CachedPasswordKey | null = null;

function bytesToBase64(bytes: Uint8Array): string {
  let output = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
    output += String.fromCharCode(...chunk);
  }
  return btoa(output);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function hasStoredPasswords(): boolean {
  return hasSecureValue(SECURE_STORAGE);
}

export async function readPasswordsBackup(password: string): Promise<string | null> {
  return readSecureValue(SECURE_STORAGE, password);
}

export async function writePasswordsBackup(password: string, value: string | null): Promise<void> {
  if (value === null) {
    await removeSecureValue(SECURE_STORAGE, password);
    return;
  }
  await writeSecureValue(SECURE_STORAGE, password, value);
}

function getDerivedKey(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const saltFingerprint = bytesToBase64(salt);
  const cacheFingerprint = `${saltFingerprint}:${iterations}`;
  if (cachedKey && cachedKey.password === password && cachedKey.salt === cacheFingerprint) {
    return Promise.resolve(cachedKey.key);
  }

  return window.crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
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

function getSaltAndBlob(rawValue: string | null) {
  let blob: EncryptedPasswordVault | null = null;
  try {
    blob = rawValue ? (JSON.parse(rawValue) as EncryptedPasswordVault) : null;
  } catch {
    blob = null;
  }
  if (!blob?.salt || !blob.iv || !blob.data) {
    return { blob: null, salt: null };
  }
  return { blob, salt: base64ToBytes(blob.salt) };
}

export async function loadPasswords(password: string): Promise<PasswordEntry[]> {
  if (typeof window === "undefined") {
    return [];
  }

  let rawValue: string | null;
  try {
    rawValue = await readSecureValue(SECURE_STORAGE, password);
  } catch {
    throw new Error("Invalid password or inaccessible secure password storage.");
  }
  if (!rawValue) {
    return [];
  }
  let blob: EncryptedPasswordVault;
  try {
    blob = JSON.parse(rawValue) as EncryptedPasswordVault;
  } catch {
    throw new Error("Password vault is corrupted.");
  }
  if (!blob.salt || !blob.iv || !blob.data) {
    throw new Error("Password vault is corrupted.");
  }

  const salt = base64ToBytes(blob.salt);
  const iv = base64ToBytes(blob.iv);
  const cipherText = base64ToBytes(blob.data);
  const key = await getDerivedKey(password, salt, blob.iterations ?? LEGACY_PBKDF2_ITERATIONS);

  try {
    const plainText = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherText);
    const decoded = decoder.decode(new Uint8Array(plainText));
    if (decoded.trim() === "") {
      if (isDesktopApp() && window.localStorage.getItem(PASSWORDS_STORAGE_KEY) !== null) {
        await writeSecureValue(SECURE_STORAGE, password, rawValue);
      }
      return [];
    }
    const secrets = JSON.parse(decoded) as PasswordEntry[];
    if (!Array.isArray(secrets)) {
      if (isDesktopApp() && window.localStorage.getItem(PASSWORDS_STORAGE_KEY) !== null) {
        await writeSecureValue(SECURE_STORAGE, password, rawValue);
      }
      return [];
    }
    const normalized = secrets.sort((a, b) => {
      const aTime = Date.parse(a.updatedAt);
      const bTime = Date.parse(b.updatedAt);
      if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) {
        return 0;
      }
      return bTime - aTime;
    });
    if (isDesktopApp() && window.localStorage.getItem(PASSWORDS_STORAGE_KEY) !== null) {
      await writeSecureValue(SECURE_STORAGE, password, rawValue);
    }
    return normalized;
  } catch {
    cachedKey = null;
    throw new Error("Invalid password or corrupted password vault.");
  }
}

export async function savePasswords(password: string, secrets: PasswordEntry[]): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const existing = getSaltAndBlob(await readSecureValue(SECURE_STORAGE, password));
  if (existing.blob && existing.salt) {
    try {
      const existingKey = await getDerivedKey(password, existing.salt, existing.blob.iterations ?? LEGACY_PBKDF2_ITERATIONS);
      await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(existing.blob.iv) },
        existingKey,
        base64ToBytes(existing.blob.data)
      );
    } catch {
      clearPasswordKeyCache();
      throw new Error("Invalid password or corrupted password vault.");
    }
  }
  const salt = existing.salt ?? window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await getDerivedKey(password, salt);

  const encoded = encoder.encode(JSON.stringify(secrets));
  const cipherText = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  const blob: EncryptedPasswordVault = {
    version: PASSWORD_ENCRYPTION_VERSION,
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(new Uint8Array(iv)),
    data: bytesToBase64(new Uint8Array(cipherText)),
  };

  await writeSecureValue(SECURE_STORAGE, password, JSON.stringify(blob));
}

export async function clearPasswords(password?: string): Promise<void> {
  clearPasswordKeyCache();
  await removeSecureValue(SECURE_STORAGE, password);
}

export function clearPasswordKeyCache(): void {
  cachedKey = null;
}
