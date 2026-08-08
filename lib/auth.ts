type WalletUser = {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  iterations?: number;
  createdAt: string;
};

type SessionState = {
  userId: string;
  username: string;
  createdAt: string;
  lastActiveAt: string;
};

const USERS_STORAGE_KEY = "vaultflow-users:v1";
const SESSION_STORAGE_KEY = "vaultflow-session:v1";
const SESSION_MAX_AGE_MS = 60 * 60 * 24 * 7 * 1000; // 7 days
const LEGACY_PBKDF2_ITERATIONS = 120000;
const PBKDF2_ITERATIONS = 310000;
export const MIN_ACCOUNT_PASSWORD_LENGTH = 12;

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

function readUsers(): WalletUser[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(USERS_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as WalletUser[];
  } catch {
    return [];
  }
}

function writeUsers(users: WalletUser[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

async function derivePasswordHash(password: string, saltB64: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const encoder = new TextEncoder();
  const salt = base64ToBytes(saltB64);
  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derivedBits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    256
  );
  return bytesToBase64(new Uint8Array(derivedBits));
}

function readSession(): SessionState | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as SessionState;
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

function writeSession(state: SessionState): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
}

function isSessionFresh(state: SessionState): boolean {
  const lastActiveAt = new Date(state.lastActiveAt).valueOf();
  if (!Number.isFinite(lastActiveAt)) {
    return false;
  }
  return Date.now() - lastActiveAt <= SESSION_MAX_AGE_MS;
}

function refreshSession(state: SessionState): void {
  writeSession({
    ...state,
    lastActiveAt: new Date().toISOString(),
  });
}

export function hasStoredAccounts(): boolean {
  return readUsers().length > 0;
}

export function getCurrentSession(): SessionState | null {
  const state = readSession();
  if (!state || !isSessionFresh(state)) {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    return null;
  }
  refreshSession(state);
  return state;
}

export function getCurrentUser(): WalletUser | null {
  const session = getCurrentSession();
  if (!session) {
    return null;
  }
  const users = readUsers();
  return users.find((user) => user.id === session.userId) ?? null;
}

export async function createAccount(username: string, password: string): Promise<string | null> {
  if (!username.trim() || !password) {
    return "Username and password are required.";
  }
  if (password.length < MIN_ACCOUNT_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_ACCOUNT_PASSWORD_LENGTH} characters.`;
  }

  const users = readUsers();
  const normalized = normalizeUsername(username);
  const existing = users.some((user) => normalizeUsername(user.username) === normalized);
  if (existing) {
    return "That account already exists.";
  }

  const salt = bytesToBase64(window.crypto.getRandomValues(new Uint8Array(16)));
  const passwordHash = await derivePasswordHash(password, salt);
  const now = new Date().toISOString();
  const nextUser: WalletUser = {
    id: crypto.randomUUID(),
    username: username.trim(),
    passwordHash,
    salt,
    iterations: PBKDF2_ITERATIONS,
    createdAt: now,
  };
  users.push(nextUser);
  writeUsers(users);
  writeSession({
    userId: nextUser.id,
    username: nextUser.username,
    createdAt: now,
    lastActiveAt: now,
  });
  return null;
}

export async function login(username: string, password: string): Promise<string | null> {
  if (!username.trim() || !password) {
    return "Username and password are required.";
  }

  const users = readUsers();
  const user = users.find((item) => normalizeUsername(item.username) === normalizeUsername(username));
  if (!user) {
    return "Invalid username or password.";
  }

  const iterations = user.iterations ?? LEGACY_PBKDF2_ITERATIONS;
  const passwordHash = await derivePasswordHash(password, user.salt, iterations);
  if (passwordHash !== user.passwordHash) {
    return "Invalid username or password.";
  }

  if (iterations !== PBKDF2_ITERATIONS) {
    user.passwordHash = await derivePasswordHash(password, user.salt, PBKDF2_ITERATIONS);
    user.iterations = PBKDF2_ITERATIONS;
    writeUsers(users);
  }

  const now = new Date().toISOString();
  writeSession({
    userId: user.id,
    username: user.username,
    createdAt: now,
    lastActiveAt: now,
  });
  return null;
}

export function logout(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}
