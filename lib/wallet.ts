export interface WalletSecret {
  id: string;
  project: string;
  app: string;
  name: string;
  value: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface EncryptedWallet {
  version: number;
  salt: string;
  iv: string;
  data: string;
}

const WALLET_STORAGE_KEY = "myapp-wallet:v1";
const ENCRYPTION_VERSION = 1;

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function getStoredWalletBlob(): EncryptedWallet | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(WALLET_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as EncryptedWallet;
  } catch {
    return null;
  }
}

export function hasStoredWallet(): boolean {
  return getStoredWalletBlob() !== null;
}

function getDerivedKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  return window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
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
  const blob = getStoredWalletBlob();
  if (!blob?.salt || !blob.iv || !blob.data) {
    return { blob: null, salt: null };
  }
  return { blob, salt: base64ToBytes(blob.salt) };
}

export async function loadWallet(password: string): Promise<WalletSecret[]> {
  if (typeof window === "undefined") {
    return [];
  }

  const blob = getStoredWalletBlob();
  if (!blob) {
    return [];
  }
  if (!blob.salt || !blob.iv || !blob.data) {
    throw new Error("Wallet data is corrupted.");
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
    const secrets = JSON.parse(decoded) as WalletSecret[];
    return Array.isArray(secrets) ? secrets : [];
  } catch {
    throw new Error("Invalid password or corrupted wallet file.");
  }
}

export async function saveWallet(password: string, secrets: WalletSecret[]): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const existing = getSaltAndBlob();
  const salt = existing.salt ?? window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await getDerivedKey(password, salt);

  const encoded = new TextEncoder().encode(JSON.stringify(secrets));
  const cipherText = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  const blob: EncryptedWallet = {
    version: ENCRYPTION_VERSION,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(new Uint8Array(iv)),
    data: bytesToBase64(new Uint8Array(cipherText)),
  };

  window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(blob));
}

export function clearWallet(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
  }
}
