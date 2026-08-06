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
  salt: string;
  iv: string;
  data: string;
}

const PASSWORDS_STORAGE_KEY = "vaultflow-passwords:v1";
const PASSWORD_ENCRYPTION_VERSION = 1;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getStoredVaultBlob(): EncryptedPasswordVault | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(PASSWORDS_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as EncryptedPasswordVault;
  } catch {
    return null;
  }
}

export function hasStoredPasswords(): boolean {
  return getStoredVaultBlob() !== null;
}

function getDerivedKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  return window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  ).then((baseKey) =>
    window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 120000,
        hash: "SHA-256",
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    )
  );
}

function getSaltAndBlob() {
  const blob = getStoredVaultBlob();
  if (!blob?.salt || !blob.iv || !blob.data) {
    return { blob: null, salt: null };
  }
  return { blob, salt: base64ToBytes(blob.salt) };
}

export async function loadPasswords(password: string): Promise<PasswordEntry[]> {
  if (typeof window === "undefined") {
    return [];
  }

  const blob = getStoredVaultBlob();
  if (!blob) {
    return [];
  }
  if (!blob.salt || !blob.iv || !blob.data) {
    throw new Error("Password vault is corrupted.");
  }

  const salt = base64ToBytes(blob.salt);
  const iv = base64ToBytes(blob.iv);
  const cipherText = base64ToBytes(blob.data);
  const key = await getDerivedKey(password, salt);

  try {
    const plainText = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherText);
    const decoded = new TextDecoder().decode(new Uint8Array(plainText));
    if (decoded.trim() === "") {
      return [];
    }
    const secrets = JSON.parse(decoded) as PasswordEntry[];
    return Array.isArray(secrets) ? secrets : [];
  } catch {
    throw new Error("Invalid password or corrupted password vault.");
  }
}

export async function savePasswords(password: string, secrets: PasswordEntry[]): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const existing = getSaltAndBlob();
  const salt = existing.salt ?? window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await getDerivedKey(password, salt);

  const encoded = new TextEncoder().encode(JSON.stringify(secrets));
  const cipherText = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  const blob: EncryptedPasswordVault = {
    version: PASSWORD_ENCRYPTION_VERSION,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(new Uint8Array(iv)),
    data: bytesToBase64(new Uint8Array(cipherText)),
  };

  window.localStorage.setItem(PASSWORDS_STORAGE_KEY, JSON.stringify(blob));
}

export function clearPasswords(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(PASSWORDS_STORAGE_KEY);
  }
}
