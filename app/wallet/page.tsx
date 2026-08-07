"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { invoke } from "@tauri-apps/api/core";
import {
  clearWallet,
  clearWalletKeyCache,
  hasStoredWallet,
  loadWallet,
  saveWallet,
  WalletSecret,
} from "../../lib/wallet";
import { getCurrentSession, logout } from "../../lib/auth";

type FormState = Omit<WalletSecret, "id" | "createdAt" | "updatedAt">;
type ImportableSecret = Omit<WalletSecret, "id" | "createdAt" | "updatedAt">;
type SecretRecord = { key: string; value: string };
type ScanInputFile = {
  name: string;
  relativePath: string;
  size: number;
  readText: () => Promise<string>;
};
type NativeFolderFile = {
  name: string;
  relative_path: string;
  size: number;
  content: string;
};

const blankForm: FormState = {
  project: "",
  app: "",
  name: "",
  value: "",
  notes: "",
};

const inputClass =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#0a66c2] focus:ring-2 focus:ring-[#0a66c2]/20";

const MAX_SCAN_FILE_BYTES = 1024 * 1024;
const SCAN_SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "target",
  "coverage",
  "vendor",
  "out",
  "site",
]);
const SCAN_TEXT_EXTENSIONS = new Set([
  ".bash",
  ".cjs",
  ".conf",
  ".config",
  ".cs",
  ".go",
  ".ini",
  ".java",
  ".js",
  ".jsx",
  ".mjs",
  ".php",
  ".pem",
  ".properties",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const LIKELY_SECRET_KEY = /(api[_-]?key|apikey|secret|token|password|passwd|private[_-]?key|client[_-]?secret|access[_-]?key|auth|credential|database[_-]?(url|password|user)|dsn|webhook|signing|encryption|jwt|bearer|oauth)/i;
const PLACEHOLDER_SECRET_VALUE = /^(?:your[_-]?|replace[_-]?|change[_-]?|example|sample|dummy|placeholder|todo|fixme|undefined|null|true|false|\$\{|<|\[)/i;

function stripValueWrapper(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseEnvContent(content: string): SecretRecord[] {
  const parsed: SecretRecord[] = [];
  for (const line of content.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#") || raw.startsWith(";")) {
      continue;
    }
    const cleaned = raw.replace(/^export\s+/, "");
    const equals = cleaned.indexOf("=");
    if (equals <= 0) {
      continue;
    }
    const key = cleaned.slice(0, equals).trim();
    const rawValue = cleaned.slice(equals + 1).trim();
    if (!key) {
      continue;
    }
    parsed.push({ key, value: stripValueWrapper(rawValue) });
  }
  return parsed;
}

function parseJsonContent(content: string): SecretRecord[] {
  try {
    const payload = JSON.parse(content);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return [];
    }
    const parsed: SecretRecord[] = [];
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        parsed.push({ key, value: String(value) });
      }
    }
    return parsed;
  } catch {
    return [];
  }
}

function parseJsonSecrets(content: string): SecretRecord[] {
  try {
    const payload = JSON.parse(content);
    const parsed: SecretRecord[] = [];
    const walk = (value: unknown) => {
      if (!value || typeof value !== "object") {
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        if (
          (typeof child === "string" || typeof child === "number" || typeof child === "boolean") &&
          isLikelySecretPair(key, String(child))
        ) {
          parsed.push({ key, value: String(child) });
        } else if (child && typeof child === "object") {
          walk(child);
        }
      }
    };
    walk(payload);
    return parsed;
  } catch {
    return [];
  }
}

function parseAssignmentContent(content: string): SecretRecord[] {
  const parsed: SecretRecord[] = [];
  const assignmentPattern =
    /(?:^|\r?\n)\s*(?:export\s+)?(?:(?:const|let|var)\s+)?([A-Za-z_][\w.-]{1,100})\s*(?:=|:)\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|`([^`\r\n]*)`|([^#;\r\n]+))/g;
  for (const match of content.matchAll(assignmentPattern)) {
    const key = match[1]?.trim();
    const value = (match[2] ?? match[3] ?? match[4] ?? match[5] ?? "").trim();
    if (key && value && isLikelySecretPair(key, value)) {
      parsed.push({ key, value: stripValueWrapper(value) });
    }
  }
  return parsed;
}

function isLikelySecretPair(key: string, value: string): boolean {
  const normalizedValue = stripValueWrapper(value.trim());
  if (!LIKELY_SECRET_KEY.test(key) || normalizedValue.length < 8) {
    return false;
  }
  return !PLACEHOLDER_SECRET_VALUE.test(normalizedValue);
}

function shouldScanFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (lower === ".env" || lower.startsWith(".env.")) {
    return true;
  }
  const lastDot = lower.lastIndexOf(".");
  if (lastDot === -1) {
    return true;
  }
  return SCAN_TEXT_EXTENSIONS.has(lower.slice(lastDot));
}

function inferProjectFromPath(relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);
  return parts.length > 0 ? parts[0] : "project";
}

function inferAppFromPath(relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return "app";
  }
  return parts[parts.length - 2];
}

function keyForSecret(secret: Pick<WalletSecret, "project" | "app" | "name">): string {
  return `${secret.project}::${secret.app}::${secret.name}`;
}

function shortTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "";
  }
  return date.toLocaleString(undefined, {
    year: "2-digit",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const PAGE_SIZE = 75;

export default function WalletPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [isLocked, setIsLocked] = useState(true);
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [username, setUsername] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"info" | "ok" | "error">("info");
  const [secrets, setSecrets] = useState<WalletSecret[]>([]);
  const [form, setForm] = useState<FormState>(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState("all");
  const [searchTermInput, setSearchTermInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [visibleSecretId, setVisibleSecretId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [hasExistingVault, setHasExistingVault] = useState(false);
  const [scanSummary, setScanSummary] = useState<{ scanned: number; found: number; skipped: number } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const clearMessageTimerRef = useRef<number | null>(null);

  const projects = useMemo(() => {
    const values = new Set(secrets.map((secret) => secret.project));
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [secrets]);

  const totalApps = useMemo(() => {
    const apps = new Set(secrets.map((secret) => `${secret.project}::${secret.app}`));
    return apps.size;
  }, [secrets]);

  const filteredSecrets = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (projectFilter === "all" && !term) {
      return secrets;
    }
    if (!term) {
      return secrets.filter((secret) => secret.project === projectFilter);
    }
    return secrets.filter((secret) => {
      if (projectFilter !== "all" && secret.project !== projectFilter) {
        return false;
      }
      const haystack = `${secret.project} ${secret.app} ${secret.name} ${secret.notes ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [searchTerm, projectFilter, secrets]);

  const visiblePage = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredSecrets.slice(start, start + PAGE_SIZE);
  }, [filteredSecrets, page]);

  const totalPages = Math.max(1, Math.ceil(filteredSecrets.length / PAGE_SIZE));

  useEffect(() => {
    setHasExistingVault(hasStoredWallet());
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchTerm(searchTermInput);
      setPage(1);
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [searchTermInput]);

  useEffect(() => {
    const session = getCurrentSession();
    if (!session) {
      router.replace("/auth");
      return;
    }
    setUsername(session.username);
    setIsAuthChecked(true);
  }, [router]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, projectFilter]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    const input = importInputRef.current;
    if (!input) {
      return;
    }
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.setAttribute("multiple", "");
  }, []);

  const clearMessage = useCallback(() => {
    if (clearMessageTimerRef.current !== null) {
      window.clearTimeout(clearMessageTimerRef.current);
    }
    clearMessageTimerRef.current = window.setTimeout(() => {
      setMessage(null);
      clearMessageTimerRef.current = null;
    }, 2800);
  }, []);

  useEffect(() => {
    return () => {
      if (clearMessageTimerRef.current !== null) {
        window.clearTimeout(clearMessageTimerRef.current);
      }
    };
  }, []);

  const onUnlock = useCallback(async () => {
    if (!password.trim()) {
      setMessageTone("error");
      setMessage("Enter a password to unlock or create your vault.");
      return;
    }
    setMessage(null);
    setIsBusy(true);
    try {
      const loaded = await loadWallet(password);
      setSecrets(loaded);
      setIsLocked(false);
      setPage(1);
      setHasExistingVault(true);
      setVisibleSecretId(null);
      setMessageTone("ok");
      setMessage("Vault unlocked successfully.");
      clearMessage();
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to unlock wallet.");
      setIsLocked(true);
    } finally {
      setIsBusy(false);
    }
  }, [clearMessage, password]);

  const resetForm = () => {
    setForm(blankForm);
    setEditingId(null);
  };

  const persist = useCallback(
    async (nextSecrets: WalletSecret[]) => {
      await saveWallet(password, nextSecrets);
      setSecrets(nextSecrets);
      setMessageTone("ok");
      setMessage("Wallet updated.");
      clearMessage();
    },
    [password, clearMessage]
  );

  const onSave = useCallback(async () => {
    if (!form.project.trim() || !form.app.trim() || !form.name.trim() || !form.value.trim()) {
      setMessageTone("error");
      setMessage("Project, app, secret name, and value are required.");
      return;
    }

    setIsBusy(true);
    try {
      const now = new Date().toISOString();
      let nextSecrets: WalletSecret[];
      if (editingId) {
        const edited = secrets.find((item) => item.id === editingId);
        if (!edited) {
          throw new Error("Secret not found.");
        }
        nextSecrets = [
          {
            ...edited,
            project: form.project.trim(),
            app: form.app.trim(),
            name: form.name.trim(),
            value: form.value.trim(),
            notes: form.notes?.trim(),
            updatedAt: now,
          },
          ...secrets.filter((item) => item.id !== editingId),
        ];
      } else {
        nextSecrets = [
          {
            id: crypto.randomUUID(),
            project: form.project.trim(),
            app: form.app.trim(),
            name: form.name.trim(),
            value: form.value.trim(),
            notes: form.notes?.trim(),
            createdAt: now,
            updatedAt: now,
          },
          ...secrets,
        ];
      }

      await persist(nextSecrets);
      resetForm();
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Failed to save secret.");
    } finally {
      setIsBusy(false);
    }
  }, [editingId, form, persist, secrets]);

  const onEdit = (secret: WalletSecret) => {
    setEditingId(secret.id);
    setForm({
      project: secret.project,
      app: secret.app,
      name: secret.name,
      value: secret.value,
      notes: secret.notes ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onDelete = useCallback(
    async (id: string) => {
      const ok = window.confirm("Delete this secret from the wallet?");
      if (!ok) {
        return;
      }
      setIsBusy(true);
      try {
        const nextSecrets = secrets.filter((item) => item.id !== id);
        await persist(nextSecrets);
        if (editingId === id) {
          resetForm();
        }
      } catch (error) {
        setMessageTone("error");
        setMessage(error instanceof Error ? error.message : "Failed to delete secret.");
      } finally {
        setIsBusy(false);
      }
    },
    [editingId, persist, secrets]
  );

  const onCopy = async (secret: WalletSecret) => {
    await navigator.clipboard.writeText(secret.value);
    setCopiedId(secret.id);
    window.setTimeout(() => setCopiedId((current) => (current === secret.id ? null : current)), 1200);
  };

  const onPasteIntoField = useCallback(
    async (field: keyof FormState) => {
      try {
        const text = await navigator.clipboard.readText();
        setForm((prev) => ({ ...prev, [field]: text.trim() }));
      } catch {
        setMessageTone("error");
        setMessage("Unable to read clipboard.");
        clearMessage();
      }
    },
    [clearMessage]
  );

  const onClearVault = () => {
    const ok = window.confirm("This removes all local vault data and locks immediately.");
    if (!ok) {
      return;
    }
    clearWallet();
    setSecrets([]);
    setIsLocked(true);
    setVisibleSecretId(null);
    setPage(1);
    setHasExistingVault(false);
    setMessageTone("ok");
    setMessage("Wallet cleared.");
    clearMessage();
  };

  const importFolderFiles = useCallback(
    async (scanFiles: ScanInputFile[]) => {
      if (!scanFiles.length) {
        setMessageTone("error");
        setMessage("That folder is empty.");
        return;
      }

      setIsBusy(true);
      setMessage(null);
      setScanSummary(null);

      try {
        const now = new Date().toISOString();
        const collected: ImportableSecret[] = [];
        const seenInScan = new Set<string>();
        let scannedFiles = 0;
        let skippedFiles = 0;
        for (const file of scanFiles) {
          const relativePath = file.relativePath.replace(/\\/g, "/");
          const filename = file.name.toLowerCase();
          const pathParts = relativePath.split("/").filter(Boolean);
          if (
            file.size > MAX_SCAN_FILE_BYTES ||
            !shouldScanFile(filename) ||
            pathParts.some((part) => SCAN_SKIP_DIRECTORIES.has(part.toLowerCase()))
          ) {
            skippedFiles++;
            continue;
          }

          scannedFiles++;
          const content = await file.readText();
          if (content.includes("\u0000")) {
            skippedFiles++;
            continue;
          }
          const isEnvFile = filename === ".env" || filename.startsWith(".env.");
          const isPemFile = filename.endsWith(".pem");
          const parsed = isPemFile
            ? [
                {
                  key: `${file.name.replace(/\.pem$/i, "").replace(/[^a-z0-9]+/gi, "_").toUpperCase() || "PEM_SECRET"}`,
                  value: content.trim(),
                },
              ]
            : isEnvFile
            ? parseEnvContent(content).filter((pair) => isLikelySecretPair(pair.key, pair.value))
            : filename.endsWith(".json")
              ? parseJsonSecrets(content)
              : parseAssignmentContent(content);
          if (!parsed.length) {
            continue;
          }

          const project = inferProjectFromPath(relativePath);
          const app = inferAppFromPath(relativePath);

          for (const pair of parsed) {
            const secretName = pair.key.trim();
            const secretValue = pair.value.trim();
            const scanKey = keyForSecret({ project, app, name: secretName });
            if (!secretName || !secretValue || seenInScan.has(scanKey)) {
              continue;
            }
            seenInScan.add(scanKey);
            collected.push({
              project,
              app,
              name: secretName,
              value: secretValue,
              notes: `Imported from ${relativePath}`,
            });
          }
        }

        setScanSummary({ scanned: scannedFiles, found: collected.length, skipped: skippedFiles });
        if (!collected.length) {
          setMessageTone("error");
          setMessage(
            `I scanned ${scannedFiles} file(s), but did not find likely secrets. Try a project folder with .env or config files.`
          );
          return;
        }

        const merged = [...secrets];
        const byKey = new Map(
          merged.map((secret) => [keyForSecret({ project: secret.project, app: secret.app, name: secret.name }), secret])
        );

        let added = 0;
        let updated = 0;

        for (const candidate of collected) {
          const candidateKey = keyForSecret(candidate);
          const existing = byKey.get(candidateKey);
          if (existing) {
            existing.value = candidate.value;
            existing.notes = existing.notes ? `${existing.notes}; ${candidate.notes}` : candidate.notes;
            existing.updatedAt = now;
            updated++;
            continue;
          }

          const nextSecret: WalletSecret = {
            id: crypto.randomUUID(),
            createdAt: now,
            updatedAt: now,
            ...candidate,
          };
          merged.push(nextSecret);
          byKey.set(candidateKey, nextSecret);
          added++;
        }

        await persist(merged);
        setPage(1);
        setVisibleSecretId(null);
        setMessageTone("ok");
        setMessage(`Found ${collected.length} secret(s). Added ${added} and updated ${updated}.`);
      } catch (error) {
        setMessageTone("error");
        setMessage(error instanceof Error ? error.message : "Failed to import from folder.");
      } finally {
        setIsBusy(false);
      }
    },
    [persist, secrets]
  );

  const onImportFolder = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(event.target.files ?? []);
      await importFolderFiles(
        selectedFiles.map((file) => ({
          name: file.name,
          relativePath: ((file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name).replace(/\\/g, "/"),
          size: file.size,
          readText: () => file.text(),
        }))
      );
      event.target.value = "";
    },
    [importFolderFiles]
  );

  const openFolderPicker = useCallback(async () => {
    const internals = (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    if (!internals) {
      importInputRef.current?.click();
      return;
    }

    try {
      const nativeFiles = await invoke<NativeFolderFile[] | null>("choose_and_scan_folder");
      if (!nativeFiles) {
        return;
      }
      await importFolderFiles(
        nativeFiles.map((file) => ({
          name: file.name,
          relativePath: file.relative_path,
          size: file.size,
          readText: async () => file.content,
        }))
      );
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to open the folder picker.");
    }
  }, [importFolderFiles]);
  const onImportClipboard = useCallback(async () => {
    setIsBusy(true);
    setMessage(null);

    try {
      const pastedText = await navigator.clipboard.readText();
      const parsed = parseEnvContent(pastedText);
      const clipboardSecrets = parsed.length ? parsed : parseJsonContent(pastedText);

      if (!clipboardSecrets.length) {
        setMessageTone("error");
        setMessage("Clipboard does not contain supported secret format.");
        return;
      }

      const now = new Date().toISOString();
      const collected: ImportableSecret[] = [];
      for (const pair of clipboardSecrets) {
        const secretName = pair.key.trim();
        const secretValue = pair.value.trim();
        if (!secretName || !secretValue) {
          continue;
        }
        collected.push({
          project: "clipboard",
          app: "imports",
          name: secretName,
          value: secretValue,
          notes: "Imported from clipboard",
        });
      }

      if (!collected.length) {
        setMessageTone("error");
        setMessage("Clipboard contained no valid secret pairs.");
        return;
      }

      const merged = [...secrets];
      const byKey = new Map(
        merged.map((secret) => [keyForSecret({ project: secret.project, app: secret.app, name: secret.name }), secret])
      );

      let added = 0;
      let updated = 0;
      for (const candidate of collected) {
        const candidateKey = keyForSecret(candidate);
        const existing = byKey.get(candidateKey);
        if (existing) {
          existing.value = candidate.value;
          existing.notes = existing.notes ? `${existing.notes}; ${candidate.notes}` : candidate.notes;
          existing.updatedAt = now;
          updated++;
          continue;
        }

        const nextSecret: WalletSecret = {
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          ...candidate,
        };
        merged.push(nextSecret);
        byKey.set(candidateKey, nextSecret);
        added++;
      }

      await persist(merged);
      setPage(1);
      setVisibleSecretId(null);
      setMessageTone("ok");
      setMessage(`Clipboard import: added ${added}, updated ${updated}.`);
      clearMessage();
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Failed to import from clipboard.");
    } finally {
      setIsBusy(false);
    }
  }, [persist, secrets, clearMessage]);

  const onSignOut = useCallback(() => {
    clearWalletKeyCache();
    logout();
    setIsLocked(true);
    setSecrets([]);
    setVisibleSecretId(null);
    setPage(1);
    router.replace("/auth");
  }, [router]);

  const onLock = useCallback(() => {
    clearWalletKeyCache();
    setPassword("");
    setSecrets([]);
    setVisibleSecretId(null);
    setPage(1);
    setIsLocked(true);
  }, []);
  const messageClass =
    messageTone === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : messageTone === "ok"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-blue-200 bg-blue-50 text-blue-700";

  if (isLocked) {
    if (!isAuthChecked) {
      return (
        <section className="wallet-page mx-auto max-w-2xl">
          <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
            <p className="text-sm text-slate-500">Checking session...</p>
          </div>
        </section>
      );
    }
    return (
      <section className="wallet-page mx-auto max-w-2xl">
        <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#0a66c2]">Secure Access</p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900">Project API Vault</h1>
          <p className="mt-2 text-sm text-slate-600">
            Unlock your local vault to add, edit, and filter secrets across projects. Data stays in your browser and is encrypted with your
            master password.
          </p>
          <p className="mt-2 text-xs text-slate-500">Signed in as {username}</p>
          {!hasExistingVault && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
              No existing vault found. Set any password to create one.
            </div>
          )}
          {message && <p className={`mt-4 rounded-xl border p-3 text-sm ${messageClass}`}>{message}</p>}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onUnlock();
            }}
          >
            <label className="mt-6 block text-sm font-medium text-slate-700" htmlFor="masterPassword">
              Master Password
            </label>
            <input
              id="masterPassword"
              type="password"
              className={`${inputClass}`}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password..."
            />
            <button
              type="submit"
              disabled={isBusy}
              className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0a66c2] px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-[#004182] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBusy ? "Unlocking..." : "Unlock Wallet"}
            </button>
          </form>
        </div>
      </section>
    );
  }

  return (
    <div className="wallet-page space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-black/30">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#0a66c2]">Workspace</p>
            <h1 className="mt-1 text-3xl font-semibold text-slate-900">Project API Wallet</h1>
            <p className="mt-2 text-sm text-slate-600">Keep every project secret in one simple, private place.</p>
          </div>
        <div className="flex items-center gap-2">
          <Link
            href="/passwords"
            className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-[#0a66c2] hover:bg-blue-100"
          >
            Password Manager
          </Link>
          <Link
            href="/settings"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Settings
          </Link>
          <button
            onClick={onSignOut}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Sign Out
            </button>
            <button
            onClick={onLock}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Lock Wallet
            </button>
            <button
              onClick={onClearVault}
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 hover:bg-red-100"
            >
              Clear Vault
            </button>
          </div>
        </div>

        {message && <p className={`mt-4 rounded-xl border p-3 text-sm ${messageClass}`}>{message}</p>}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-gray-400">Total Secrets</p>
            <p className="mt-3 text-2xl font-semibold">{secrets.length}</p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-gray-400">Projects</p>
            <p className="mt-3 text-2xl font-semibold">{projects.length}</p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-gray-400">Apps</p>
            <p className="mt-3 text-2xl font-semibold">{totalApps}</p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-gray-400">Filtered</p>
            <p className="mt-3 text-2xl font-semibold">{filteredSecrets.length}</p>
          </article>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-5">
        <article className="lg:col-span-2 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-sm font-semibold text-slate-900">Find secrets automatically</p>
          <p className="mt-2 text-sm text-slate-600">
            Choose a project folder and Wallet will look through common config files for API keys, tokens, passwords, and other secrets.
            It skips dependency folders and keeps everything on this computer.
          </p>
          <p className="mt-3 text-xs font-medium text-slate-500">Looks in .env, JSON, YAML, TOML, PEM, and source config files.</p>
          <button
            type="button"
            onClick={openFolderPicker}
            disabled={isBusy}
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0a66c2] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#004182] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? "Scanning folder..." : "Choose folder to scan"}
          </button>
          <button
            type="button"
            onClick={onImportClipboard}
            disabled={isBusy}
            className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? "Reading clipboard..." : "Paste & import from clipboard"}
          </button>
          {scanSummary && (
            <p className="mt-3 text-xs text-slate-500">
              Last scan: {scanSummary.scanned} file(s) checked, {scanSummary.found} secret(s) found
              {scanSummary.skipped ? `, ${scanSummary.skipped} skipped` : ""}.
            </p>
          )}
          <input ref={importInputRef} type="file" className="hidden" onChange={onImportFolder} />
        </article>

        <article className="lg:col-span-3 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-sm font-semibold text-gray-200">{editingId ? "Update Secret" : "Add Secret"}</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm text-gray-300" htmlFor="project">
                Project
              </label>
              <input
                id="project"
                className={inputClass}
                value={form.project}
                onChange={(event) => setForm((prev) => ({ ...prev, project: event.target.value }))}
                placeholder="acme-portal"
              />
            </div>
            <div>
              <label className="text-sm text-gray-300" htmlFor="app">
                App
              </label>
              <input
                id="app"
                className={inputClass}
                value={form.app}
                onChange={(event) => setForm((prev) => ({ ...prev, app: event.target.value }))}
                placeholder="backend"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="text-sm text-gray-300" htmlFor="name">
              Secret Name
            </label>
            <input
              id="name"
              className={inputClass}
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="OPENAI_API_KEY"
            />
            <button
              type="button"
              onClick={() => onPasteIntoField("name")}
              className="mt-2 inline-flex h-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-4 text-xs font-semibold text-gray-200 hover:bg-white/10"
            >
              Paste name
            </button>
          </div>

          <div className="mt-4">
            <label className="text-sm text-gray-300" htmlFor="value">
              Secret Value
            </label>
            <input
              id="value"
              className={inputClass}
              value={form.value}
              onChange={(event) => setForm((prev) => ({ ...prev, value: event.target.value }))}
              placeholder="sk-..."
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => onPasteIntoField("value")}
              className="mt-2 inline-flex h-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-4 text-xs font-semibold text-gray-200 hover:bg-white/10"
            >
              Paste value
            </button>
          </div>

          <div className="mt-4">
            <label className="text-sm text-gray-300" htmlFor="notes">
              Notes (optional)
            </label>
            <textarea
              id="notes"
              rows={3}
              className={inputClass}
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="Owner, expiry, scope, tenant..."
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={onSave}
              disabled={isBusy}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/30 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isBusy ? "Saving..." : editingId ? "Save Changes" : "Add Secret"}
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 text-sm font-semibold text-gray-200 hover:bg-white/10"
              onClick={resetForm}
            >
              Cancel
            </button>
          </div>
        </article>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <select
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-gray-200 md:w-auto"
          >
            <option value="all">All projects</option>
            {projects.map((project) => (
              <option key={project} value={project}>
                {project}
              </option>
            ))}
          </select>
            <input
              className="flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-gray-200"
              value={searchTermInput}
              onChange={(event) => setSearchTermInput(event.target.value)}
              placeholder="Search project, app, secret name or notes"
            />
            <div className="text-xs text-gray-400">
              Showing page {page} of {totalPages}
            </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          {filteredSecrets.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-gray-400">
              No secrets found for this filter.
            </div>
          ) : (
            <>
            <table className="min-w-full table-fixed border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.12em] text-gray-400">
                  <th className="w-1/4 px-4 py-3">Secret</th>
                  <th className="w-1/6 px-4 py-3">Project</th>
                  <th className="w-1/6 px-4 py-3">App</th>
                  <th className="w-1/6 px-4 py-3">Updated</th>
                  <th className="w-2/6 px-4 py-3">Value</th>
                  <th className="w-1/5 px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visiblePage.map((secret) => {
                  const isRevealed = visibleSecretId === secret.id;
                  const masked = "*".repeat(Math.min(18, Math.max(6, secret.value.length || 6)));
                  return (
                    <tr key={secret.id} className="border-t border-white/10">
                      <td className="px-4 py-3 text-sm font-medium text-gray-100">
                        <p className="truncate" title={secret.name}>
                          {secret.name}
                        </p>
                        {secret.notes && (
                          <p className="mt-1 truncate text-xs text-gray-400" title={secret.notes}>
                            {secret.notes}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">{secret.project}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{secret.app}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{shortTime(secret.updatedAt)}</td>
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs text-gray-300 break-all">
                          {isRevealed ? secret.value : masked}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => setVisibleSecretId((current) => (current === secret.id ? null : secret.id))}
                            className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-gray-200 hover:bg-white/10"
                          >
                            {isRevealed ? "Hide" : "Reveal"}
                          </button>
                          <button
                            onClick={() => onCopy(secret)}
                            className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-gray-200 hover:bg-white/10"
                          >
                            {copiedId === secret.id ? "Copied" : "Copy"}
                          </button>
                          <button
                            onClick={() => onEdit(secret)}
                            className="rounded-lg border border-cyan-400/30 bg-cyan-300/10 px-2.5 py-1.5 text-xs text-cyan-100 hover:bg-cyan-300/20"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => onDelete(secret.id)}
                            className="rounded-lg border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-100 hover:bg-red-400/20"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              <button
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page === totalPages}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}


