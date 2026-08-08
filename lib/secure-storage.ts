type SecureStorageConfig = {
  storageKey: string;
  markerKey: string;
  clientName: string;
  recordKey: string;
  snapshotName: string;
};

type StrongholdStore = {
  get: (key: string) => Promise<Uint8Array | null>;
  insert: (key: string, value: number[]) => Promise<void>;
  remove: (key: string) => Promise<Uint8Array | null>;
};

type StrongholdHandle = {
  save: () => Promise<void>;
  unload: () => Promise<void>;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function readBrowserValue(config: SecureStorageConfig): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(config.storageKey);
}

async function withStronghold<T>(
  config: SecureStorageConfig,
  password: string,
  operation: (store: StrongholdStore) => Promise<T>
): Promise<T | undefined> {
  if (!isDesktopApp()) {
    return undefined;
  }

  const [{ Stronghold }, { appDataDir }] = await Promise.all([
    import("@tauri-apps/plugin-stronghold"),
    import("@tauri-apps/api/path"),
  ]);
  const appData = await appDataDir();
  const snapshotPath = `${appData.replace(/[\\/]$/, "")}/${config.snapshotName}.hold`;
  const stronghold = (await Stronghold.load(snapshotPath, password)) as StrongholdHandle & {
    loadClient: (name: string) => Promise<{ getStore: () => StrongholdStore }>;
    createClient: (name: string) => Promise<{ getStore: () => StrongholdStore }>;
  };

  try {
    let client: { getStore: () => StrongholdStore };
    try {
      client = await stronghold.loadClient(config.clientName);
    } catch {
      client = await stronghold.createClient(config.clientName);
    }
    return await operation(client.getStore());
  } finally {
    try {
      await stronghold.save();
    } finally {
      await stronghold.unload();
    }
  }
}

export function hasSecureValue(config: SecureStorageConfig): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(config.storageKey) !== null || window.localStorage.getItem(config.markerKey) === "1";
}

export async function readSecureValue(config: SecureStorageConfig, password: string): Promise<string | null> {
  const legacyValue = readBrowserValue(config);
  const hasSecureMarker = typeof window !== "undefined" && window.localStorage.getItem(config.markerKey) === "1";
  // During first-run migration, read the legacy blob before opening Stronghold. This prevents a
  // mistyped password from creating an empty snapshot with the wrong Stronghold password.
  if (isDesktopApp() && legacyValue !== null && !hasSecureMarker) {
    return legacyValue;
  }

  const secureValue = await withStronghold(config, password, async (store) => {
    const bytes = await store.get(config.recordKey);
    return bytes ? decoder.decode(new Uint8Array(bytes)) : null;
  });

  if (secureValue !== undefined) {
    if (secureValue !== null) {
      return secureValue;
    }

    if (legacyValue !== null) {
      return legacyValue;
    }
    return null;
  }

  return readBrowserValue(config);
}

export async function writeSecureValue(config: SecureStorageConfig, password: string, value: string): Promise<void> {
  const secureWrite = await withStronghold(config, password, async (store) => {
    await store.insert(config.recordKey, Array.from(encoder.encode(value)));
  });

  if (secureWrite !== undefined) {
    window.localStorage.removeItem(config.storageKey);
    window.localStorage.setItem(config.markerKey, "1");
    return;
  }

  window.localStorage.setItem(config.storageKey, value);
}

export async function removeSecureValue(config: SecureStorageConfig, password?: string): Promise<void> {
  if (password && isDesktopApp()) {
    await withStronghold(config, password, async (store) => {
      await store.remove(config.recordKey);
    });
  }
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(config.storageKey);
    window.localStorage.removeItem(config.markerKey);
  }
}
