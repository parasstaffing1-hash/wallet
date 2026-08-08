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
  loadWalletFolders,
  saveWallet,
  saveWalletFolders,
  WalletItemKind,
  WalletSecret,
} from "../../lib/wallet";
import { getCurrentSession, logout } from "../../lib/auth";
import { generateSecurePassword, getPasswordStrength } from "../../lib/generator";

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
  kind: "api-key",
  folder: "General",
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

function inferFolderFromPath(relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);
  return parts.length > 0 ? parts[0] : "General";
}

function inferFolderFromScan(scanFiles: ScanInputFile[]): string {
  const firstParts = scanFiles
    .map((file) => file.relativePath.replace(/\\/g, "/").split("/").filter(Boolean)[0])
    .filter(Boolean);
  const commonRoot = firstParts[0];
  if (commonRoot && firstParts.every((part) => part === commonRoot) && !shouldScanFile(commonRoot)) {
    return commonRoot;
  }
  return "General";
}

function inferAppFromPath(relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length <= 2) {
    return "app";
  }
  return parts[parts.length - 2];
}

function keyForSecret(
  secret: Pick<WalletSecret, "project" | "app" | "name"> & Partial<Pick<WalletSecret, "folder">>
): string {
  const folder = secret.folder?.trim() || "General";
  return `${folder}::${secret.project}::${secret.app}::${secret.name}`;
}

function inferItemKind(name: string, filename = ""): WalletItemKind {
  const value = `${name} ${filename}`.toLowerCase();
  if (value.endsWith(".pem") || value.includes("private_key") || value.includes("ssh")) {
    return "ssh-key";
  }
  if (value.includes("password") || value.includes("username") || value.includes("login")) {
    return "login";
  }
  if (value.includes("token") || value.includes("jwt") || value.includes("bearer")) {
    return "token";
  }
  if (value.includes("certificate") || value.includes("cert")) {
    return "certificate";
  }
  return "api-key";
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

function regroupWorkoraJobsSecrets(secrets: WalletSecret[], folders: string[]) {
  const knownFolders = Array.from(new Set([...folders, ...secrets.map((secret) => secret.folder || "General")]));
  const targetFolder = knownFolders.find((folder) => folder.trim().toLowerCase() === "workorajobs");
  if (!targetFolder) {
    return { secrets, folders, targetFolder: null, moved: 0 };
  }

  const moved = secrets.filter((secret) => (secret.folder || "General") !== targetFolder).length;
  const regroupedSecrets = secrets.map((secret) =>
    secret.folder === targetFolder ? secret : { ...secret, folder: targetFolder }
  );
  return { secrets: regroupedSecrets, folders: [targetFolder], targetFolder, moved };
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
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [form, setForm] = useState<FormState>(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [folderFilter, setFolderFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [searchTermInput, setSearchTermInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [visibleSecretId, setVisibleSecretId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [hasExistingVault, setHasExistingVault] = useState(false);
  const [scanSummary, setScanSummary] = useState<{ folder: string; scanned: number; found: number; skipped: number } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const clearMessageTimerRef = useRef<number | null>(null);

  const projects = useMemo(() => {
    const values = new Set(secrets.map((secret) => secret.project));
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [secrets]);

  const folderNames = useMemo(() => {
    const values = new Set([...customFolders, ...secrets.map((secret) => secret.folder || "General")]);
    if (values.size === 0) {
      values.add("General");
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [customFolders, secrets]);

  const folderCards = useMemo(
    () =>
      folderNames.map((name) => {
        const folderSecrets = secrets.filter((secret) => (secret.folder || "General") === name);
        const latest = folderSecrets.reduce<string | null>(
          (current, secret) => (!current || secret.updatedAt > current ? secret.updatedAt : current),
          null
        );
        return { name, count: folderSecrets.length, latest };
      }),
    [folderNames, secrets]
  );

  const totalApps = useMemo(() => {
    const apps = new Set(secrets.map((secret) => `${secret.project}::${secret.app}`));
    return apps.size;
  }, [secrets]);

  const securityHealth = useMemo(() => {
    const valueCounts = new Map<string, number>();
    secrets.forEach((secret) => valueCounts.set(secret.value, (valueCounts.get(secret.value) ?? 0) + 1));
    const weak = secrets.filter((secret) => secret.value.length < 12).length;
    const reused = secrets.filter((secret) => (valueCounts.get(secret.value) ?? 0) > 1).length;
    const horizon = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const expiring = secrets.filter((secret) => {
      if (!secret.expiresAt) return false;
      const expiresAt = Date.parse(secret.expiresAt);
      return Number.isFinite(expiresAt) && expiresAt <= horizon;
    }).length;
    return { weak, reused, expiring };
  }, [secrets]);

  const filteredSecrets = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (folderFilter === "all" && projectFilter === "all" && !term) {
      return secrets;
    }
    if (!term) {
      return secrets.filter(
        (secret) =>
          (folderFilter === "all" || (secret.folder || "General") === folderFilter) &&
          (projectFilter === "all" || secret.project === projectFilter)
      );
    }
    return secrets.filter((secret) => {
      if (folderFilter !== "all" && (secret.folder || "General") !== folderFilter) {
        return false;
      }
      if (projectFilter !== "all" && secret.project !== projectFilter) {
        return false;
      }
      const haystack = `${secret.project} ${secret.app} ${secret.name} ${secret.notes ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [folderFilter, searchTerm, projectFilter, secrets]);

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
  }, [folderFilter, searchTerm, projectFilter]);

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
      const storedFolders = loadWalletFolders();
      const regrouped = regroupWorkoraJobsSecrets(loaded, storedFolders);
      const foldersChanged =
        regrouped.folders.length !== storedFolders.length || regrouped.folders.some((folder, index) => folder !== storedFolders[index]);
      if (regrouped.targetFolder && (regrouped.moved > 0 || foldersChanged)) {
        await saveWallet(password, regrouped.secrets);
        saveWalletFolders(regrouped.folders);
      }
      setSecrets(regrouped.secrets);
      setCustomFolders(regrouped.folders);
      setIsLocked(false);
      setPage(1);
      setHasExistingVault(true);
      setVisibleSecretId(null);
      setMessageTone("ok");
      setMessage(
        regrouped.moved > 0
          ? `Grouped ${regrouped.moved} saved secret(s) into ${regrouped.targetFolder}.`
          : "Vault unlocked successfully."
      );
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

  const rememberFolder = useCallback((folder: string) => {
    const normalized = folder.trim();
    if (!normalized) {
      return;
    }
    setCustomFolders((current) => {
      const next = Array.from(new Set([...current, normalized])).sort((a, b) => a.localeCompare(b));
      saveWalletFolders(next);
      return next;
    });
  }, []);

  const onCreateFolder = useCallback(() => {
    const folder = newFolderName.trim();
    if (!folder) {
      setMessageTone("error");
      setMessage("Enter a folder name first.");
      clearMessage();
      return;
    }
    rememberFolder(folder);
    setNewFolderName("");
    setMessageTone("ok");
    setMessage(`Folder "${folder}" is ready.`);
    clearMessage();
  }, [clearMessage, newFolderName, rememberFolder]);

  const openFolder = useCallback((folder: string) => {
    setFolderFilter(folder);
    setProjectFilter("all");
    setSearchTermInput("");
    setSearchTerm("");
    setPage(1);
    window.setTimeout(() => {
      document.getElementById("secrets-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, []);

  const showAllFolders = useCallback(() => {
    setFolderFilter("all");
    setProjectFilter("all");
    setSearchTermInput("");
    setSearchTerm("");
    setPage(1);
  }, []);

  const addSecretToFolder = useCallback((folder: string) => {
    setEditingId(null);
    setForm((current) => ({ ...current, folder }));
    window.setTimeout(() => {
      document.getElementById("secret-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, []);

  const groupImportedSecrets = useCallback(
    async (targetFolder: string) => {
      const target = targetFolder.trim() || "General";
      const imported = secrets.filter(
        (secret) =>
          secret.folder !== target &&
          Boolean(secret.notes?.toLowerCase().startsWith("imported from ")) &&
          !secret.notes?.toLowerCase().includes("clipboard")
      );
      if (!imported.length) {
        setMessageTone("info");
        setMessage(`No imported file secrets are waiting outside ${target}.`);
        clearMessage();
        return;
      }
      const confirmed = window.confirm(`Move ${imported.length} imported secret(s) into the ${target} folder?`);
      if (!confirmed) {
        return;
      }
      setIsBusy(true);
      try {
        const now = new Date().toISOString();
        const nextSecrets = secrets.map((secret) =>
          imported.some((item) => item.id === secret.id)
            ? { ...secret, folder: target, updatedAt: now }
            : secret
        );
        await persist(nextSecrets);
        const importedFolderNames = new Set(imported.map((secret) => secret.folder || "General"));
        setCustomFolders((current) => {
          const next = Array.from(new Set([...current.filter((folder) => !importedFolderNames.has(folder)), target])).sort((a, b) =>
            a.localeCompare(b)
          );
          saveWalletFolders(next);
          return next;
        });
        setFolderFilter(target);
        setProjectFilter("all");
        setSearchTermInput("");
        setSearchTerm("");
        setPage(1);
        setMessageTone("ok");
        setMessage(`Grouped ${imported.length} imported secret(s) into ${target}.`);
        clearMessage();
      } catch (error) {
        setMessageTone("error");
        setMessage(error instanceof Error ? error.message : "Failed to group imported secrets.");
      } finally {
        setIsBusy(false);
      }
    },
    [clearMessage, persist, secrets]
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
            kind: form.kind,
            folder: form.folder.trim() || "General",
            project: form.project.trim(),
            app: form.app.trim(),
            name: form.name.trim(),
            value: form.value.trim(),
            username: form.username?.trim() || undefined,
            website: form.website?.trim() || undefined,
            expiresAt: form.expiresAt?.trim() || undefined,
            notes: form.notes?.trim(),
            updatedAt: now,
          },
          ...secrets.filter((item) => item.id !== editingId),
        ];
      } else {
        nextSecrets = [
          {
            id: crypto.randomUUID(),
            kind: form.kind,
            folder: form.folder.trim() || "General",
            project: form.project.trim(),
            app: form.app.trim(),
            name: form.name.trim(),
            value: form.value.trim(),
            username: form.username?.trim() || undefined,
            website: form.website?.trim() || undefined,
            expiresAt: form.expiresAt?.trim() || undefined,
            notes: form.notes?.trim(),
            createdAt: now,
            updatedAt: now,
          },
          ...secrets,
        ];
      }

      await persist(nextSecrets);
      rememberFolder(form.folder || "General");
      resetForm();
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Failed to save secret.");
    } finally {
      setIsBusy(false);
    }
  }, [editingId, form, persist, rememberFolder, secrets]);

  const onEdit = (secret: WalletSecret) => {
    setEditingId(secret.id);
    setForm({
      kind: secret.kind || "api-key",
      folder: secret.folder || "General",
      project: secret.project,
      app: secret.app,
      name: secret.name,
      value: secret.value,
      username: secret.username ?? "",
      website: secret.website ?? "",
      expiresAt: secret.expiresAt ?? "",
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

  const onMoveSecret = useCallback(
    async (id: string, folder: string) => {
      const nextFolder = folder.trim() || "General";
      const now = new Date().toISOString();
      const nextSecrets = secrets.map((secret) =>
        secret.id === id ? { ...secret, folder: nextFolder, updatedAt: now } : secret
      );
      if (nextSecrets.every((secret, index) => secret === secrets[index])) {
        return;
      }
      setIsBusy(true);
      try {
        await persist(nextSecrets);
        rememberFolder(nextFolder);
        setMessageTone("ok");
        setMessage(`Moved secret to ${nextFolder}.`);
        clearMessage();
      } catch (error) {
        setMessageTone("error");
        setMessage(error instanceof Error ? error.message : "Failed to move secret.");
      } finally {
        setIsBusy(false);
      }
    },
    [clearMessage, persist, rememberFolder, secrets]
  );

  const onRemoveFromFolder = useCallback(
    async (id: string) => {
      const secret = secrets.find((item) => item.id === id);
      const currentFolder = secret?.folder?.trim() || "General";
      if (!secret || currentFolder === "General") {
        setMessageTone("info");
        setMessage("This secret is already outside a project folder.");
        clearMessage();
        return;
      }

      const confirmed = window.confirm(
        `Remove “${secret.name}” from ${currentFolder}? It will stay in your wallet under General.`
      );
      if (!confirmed) {
        return;
      }

      setIsBusy(true);
      try {
        const now = new Date().toISOString();
        await persist(
          secrets.map((item) => (item.id === id ? { ...item, folder: "General", updatedAt: now } : item))
        );
        rememberFolder("General");
        setMessageTone("ok");
        setMessage(`Removed ${secret.name} from ${currentFolder}.`);
        clearMessage();
      } catch (error) {
        setMessageTone("error");
        setMessage(error instanceof Error ? error.message : "Failed to remove secret from folder.");
      } finally {
        setIsBusy(false);
      }
    },
    [clearMessage, persist, rememberFolder, secrets]
  );

  const onToggleFavorite = useCallback(
    async (id: string) => {
      setIsBusy(true);
      try {
        const now = new Date().toISOString();
        await persist(
          secrets.map((secret) =>
            secret.id === id ? { ...secret, favorite: !secret.favorite, updatedAt: now } : secret
          )
        );
      } catch (error) {
        setMessageTone("error");
        setMessage(error instanceof Error ? error.message : "Failed to update favorite.");
      } finally {
        setIsBusy(false);
      }
    },
    [persist, secrets]
  );

  const onCopy = async (secret: WalletSecret) => {
    await navigator.clipboard.writeText(secret.value);
    setCopiedId(secret.id);
    window.setTimeout(() => setCopiedId((current) => (current === secret.id ? null : current)), 1200);
    window.setTimeout(async () => {
      try {
        if ((await navigator.clipboard.readText()) === secret.value) {
          await navigator.clipboard.writeText("");
        }
      } catch {
        // Clipboard permissions can expire; leaving it untouched is safer than interrupting the user.
      }
    }, 30_000);
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

  const onGenerateValue = useCallback(() => {
    setForm((current) => ({ ...current, value: generateSecurePassword(24) }));
    setMessageTone("ok");
    setMessage("Generated a strong random value.");
    clearMessage();
  }, [clearMessage]);

  const valueStrength = useMemo(() => getPasswordStrength(form.value), [form.value]);

  const onClearVault = async () => {
    const ok = window.confirm("This removes all local vault data and locks immediately.");
    if (!ok) {
      return;
    }
    setIsBusy(true);
    try {
      await clearWallet(password);
      setSecrets([]);
      setCustomFolders([]);
      setNewFolderName("");
      setIsLocked(true);
      setVisibleSecretId(null);
      setPage(1);
      setHasExistingVault(false);
      setMessageTone("ok");
      setMessage("Wallet cleared.");
      clearMessage();
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to clear the wallet.");
    } finally {
      setIsBusy(false);
    }
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
        const selectedFolder = inferFolderFromScan(scanFiles);
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
            const scanKey = keyForSecret({ folder: selectedFolder, project, app, name: secretName });
            if (!secretName || !secretValue || seenInScan.has(scanKey)) {
              continue;
            }
            seenInScan.add(scanKey);
            collected.push({
              kind: inferItemKind(secretName, filename),
              folder: selectedFolder,
              project,
              app,
              name: secretName,
              value: secretValue,
              notes: `Imported from ${relativePath}`,
            });
          }
        }

        setScanSummary({ folder: selectedFolder, scanned: scannedFiles, found: collected.length, skipped: skippedFiles });
        if (!collected.length) {
          setMessageTone("error");
          setMessage(
            `I scanned ${scannedFiles} file(s) in ${selectedFolder}, but did not find likely secrets. Try a project folder with .env or config files.`
          );
          return;
        }

        const merged = [...secrets];
        const byKey = new Map(
          merged.map((secret) => [keyForSecret({ folder: secret.folder, project: secret.project, app: secret.app, name: secret.name }), secret])
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
        rememberFolder(selectedFolder);
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
    [persist, rememberFolder, secrets]
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
          kind: "api-key",
          folder: "Clipboard",
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
        merged.map((secret) => [keyForSecret({ folder: secret.folder, project: secret.project, app: secret.app, name: secret.name }), secret])
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
      rememberFolder("Clipboard");
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
  }, [persist, rememberFolder, secrets, clearMessage]);

  const onSignOut = useCallback(() => {
    clearWalletKeyCache();
    logout();
    setIsLocked(true);
    setSecrets([]);
    setCustomFolders([]);
    setNewFolderName("");
    setVisibleSecretId(null);
    setPage(1);
    router.replace("/auth");
  }, [router]);

  const onLock = useCallback(() => {
    clearWalletKeyCache();
    setPassword("");
    setSecrets([]);
    setCustomFolders([]);
    setNewFolderName("");
    setVisibleSecretId(null);
    setPage(1);
    setIsLocked(true);
  }, []);

  useEffect(() => {
    if (isLocked) {
      return;
    }
    let timer = 0;
    const resetTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => onLock(), 15 * 60 * 1000);
    };
    const activityEvents: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "mousemove", "touchstart"];
    activityEvents.forEach((event) => window.addEventListener(event, resetTimer));
    resetTimer();
    return () => {
      window.clearTimeout(timer);
      activityEvents.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [isLocked, onLock]);

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
              onClick={() => void onClearVault()}
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 hover:bg-red-100"
            >
              Clear Vault
            </button>
          </div>
        </div>

        {message && <p className={`mt-4 rounded-xl border p-3 text-sm ${messageClass}`}>{message}</p>}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
            <p className="text-xs uppercase tracking-[0.18em] text-gray-400">Folders</p>
            <p className="mt-3 text-2xl font-semibold">{folderNames.length}</p>
          </article>
          <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-amber-700">Security health</p>
            <p className="mt-3 text-2xl font-semibold text-amber-900">
              {securityHealth.weak + securityHealth.reused + securityHealth.expiring === 0 ? "Good" : securityHealth.weak + securityHealth.reused + securityHealth.expiring}
            </p>
            <p className="mt-1 text-[11px] text-amber-700">
              {securityHealth.weak} weak · {securityHealth.reused} reused · {securityHealth.expiring} due soon
            </p>
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
          <p className="mt-2 text-xs font-medium text-[#0a66c2]">Each scan is grouped into its own folder so projects stay separate.</p>
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
              Last scan: <span className="font-semibold text-slate-700">{scanSummary.folder}</span> · {scanSummary.scanned} file(s) checked, {scanSummary.found} secret(s) found
              {scanSummary.skipped ? `, ${scanSummary.skipped} skipped` : ""}.
            </p>
          )}
          <input ref={importInputRef} type="file" className="hidden" onChange={onImportFolder} />
        </article>

        <article id="secret-form" className="lg:col-span-3 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-sm font-semibold text-gray-200">{editingId ? "Update Secret" : "Add Secret"}</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm text-gray-300" htmlFor="kind">
                Item type
              </label>
              <select
                id="kind"
                className={inputClass}
                value={form.kind}
                onChange={(event) => setForm((prev) => ({ ...prev, kind: event.target.value as WalletItemKind }))}
              >
                <option value="api-key">API key</option>
                <option value="login">Login</option>
                <option value="token">Token / JWT</option>
                <option value="ssh-key">SSH / PEM key</option>
                <option value="certificate">Certificate</option>
                <option value="secure-note">Secure note</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm text-gray-300" htmlFor="folder">
                Project folder
              </label>
              <input
                id="folder"
                className={inputClass}
                value={form.folder}
                onChange={(event) => setForm((prev) => ({ ...prev, folder: event.target.value }))}
                placeholder="WorkoraJobs"
              />
              <p className="mt-1 text-xs text-slate-500">Use a simple name like Client A, Production, or Personal.</p>
            </div>
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
            <div>
              <label className="text-sm text-gray-300" htmlFor="username">
                Username (optional)
              </label>
              <input
                id="username"
                className={inputClass}
                value={form.username ?? ""}
                onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
                placeholder="you@example.com"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="text-sm text-gray-300" htmlFor="website">
                Website (optional)
              </label>
              <input
                id="website"
                className={inputClass}
                value={form.website ?? ""}
                onChange={(event) => setForm((prev) => ({ ...prev, website: event.target.value }))}
                placeholder="https://app.example.com"
                inputMode="url"
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
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onPasteIntoField("value")}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-4 text-xs font-semibold text-gray-200 hover:bg-white/10"
              >
                Paste value
              </button>
              <button
                type="button"
                onClick={onGenerateValue}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-4 text-xs font-semibold text-[#0a66c2] hover:bg-blue-100"
              >
                Generate strong value
              </button>
              {form.value && <span className="text-xs text-slate-500">Strength: {valueStrength}</span>}
            </div>
          </div>

          <div className="mt-4">
            <label className="text-sm text-gray-300" htmlFor="expiresAt">
              Review or rotate by (optional)
            </label>
            <input
              id="expiresAt"
              type="date"
              className={inputClass}
              value={form.expiresAt ?? ""}
              onChange={(event) => setForm((prev) => ({ ...prev, expiresAt: event.target.value }))}
            />
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

      <section id="folder-workspace" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0a66c2]">Organize</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">Project folders</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Open a folder to see its saved secrets. Empty folders stay available for your next import, and every secret can be moved between folders.
            </p>
          </div>
          <div className="flex w-full gap-2 lg:max-w-md">
            <input
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onCreateFolder();
                }
              }}
              placeholder="New folder name"
              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#0a66c2] focus:ring-2 focus:ring-[#0a66c2]/20"
              aria-label="New project folder name"
            />
            <button
              type="button"
              onClick={onCreateFolder}
              disabled={isBusy}
              className="rounded-xl bg-[#0a66c2] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#004182] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Create folder
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {folderCards.map(({ name, count, latest }) => {
            const isOpen = folderFilter === name;
            return (
              <article
                key={name}
                className={`rounded-2xl border p-4 transition ${
                  isOpen ? "border-[#0a66c2] bg-blue-50 shadow-sm" : "border-slate-200 bg-slate-50/70 hover:border-blue-200 hover:bg-blue-50/40"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-lg shadow-sm" aria-hidden="true">
                    📁
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600">
                    {count} {count === 1 ? "secret" : "secrets"}
                  </span>
                </div>
                <h3 className="mt-4 truncate text-sm font-semibold text-slate-900" title={name}>{name}</h3>
                <p className="mt-1 min-h-9 text-xs text-slate-500">
                  {count ? `Last updated ${shortTime(latest ?? "")}` : "Empty folder — ready for import"}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openFolder(name)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      isOpen ? "bg-[#0a66c2] text-white" : "border border-blue-200 bg-white text-[#0a66c2] hover:bg-blue-50"
                    }`}
                  >
                    {isOpen ? "Folder open" : "Open folder"}
                  </button>
                  <button
                    type="button"
                    onClick={() => addSecretToFolder(name)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Add secret here
                  </button>
                  <button
                    type="button"
                    onClick={() => void groupImportedSecrets(name)}
                    disabled={isBusy}
                    className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0a66c2] hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Group imports here
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        {folderFilter !== "all" && (
          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">Open folder: {folderFilter}</p>
              <p className="mt-1 text-xs text-slate-600">
                {folderCards.find((folder) => folder.name === folderFilter)?.count ?? 0} saved secret(s). Use Move to to place a secret here, or Remove from folder to keep it in the wallet without a project folder.
              </p>
            </div>
            <button
              type="button"
              onClick={showAllFolders}
              className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-[#0a66c2] hover:bg-blue-50"
            >
              Show all folders
            </button>
          </div>
        )}
      </section>

      <section id="secrets-table" className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <select
            value={folderFilter}
            onChange={(event) => setFolderFilter(event.target.value)}
            className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-gray-200 md:w-auto"
          >
            <option value="all">All folders</option>
            {folderNames.map((folder) => (
              <option key={folder} value={folder}>
                {folder}
              </option>
            ))}
          </select>
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

        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          {filteredSecrets.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-gray-400">
              No secrets found for this filter.
            </div>
          ) : (
            <>
            <table className="w-full min-w-[980px] table-fixed border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.12em] text-gray-400">
                  <th className="w-[24%] px-3 py-3">Secret</th>
                  <th className="w-[12%] px-3 py-3">Project</th>
                  <th className="w-[10%] px-3 py-3">App</th>
                  <th className="w-[11%] px-3 py-3">Updated</th>
                  <th className="w-[12%] px-3 py-3">Value</th>
                  <th className="w-[31%] px-3 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visiblePage.map((secret) => {
                  const isRevealed = visibleSecretId === secret.id;
                  const masked = "*".repeat(Math.min(18, Math.max(6, secret.value.length || 6)));
                  return (
                    <tr key={secret.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                      <td className="max-w-0 px-3 py-3 align-top text-sm font-medium text-gray-100">
                        <p className="truncate" title={secret.name}>
                          {secret.name}
                        </p>
                        <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {(secret.kind || "api-key").replace("-", " ")}
                        </span>
                        <p className="mt-1 truncate text-xs font-medium text-[#0a66c2]" title={secret.folder || "General"}>
                          {secret.folder || "General"}
                        </p>
                        {secret.notes && (
                          <p className="mt-1 truncate text-xs text-gray-400" title={secret.notes}>
                            {secret.notes}
                          </p>
                        )}
                      </td>
                      <td className="max-w-0 truncate px-3 py-3 align-top text-sm text-gray-300" title={secret.project}>{secret.project}</td>
                      <td className="max-w-0 truncate px-3 py-3 align-top text-sm text-gray-300" title={secret.app}>{secret.app}</td>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs text-gray-400">{shortTime(secret.updatedAt)}</td>
                      <td className="max-w-0 px-3 py-3 align-top">
                        <p className="font-mono text-xs text-gray-300 break-all">
                          {isRevealed ? secret.value : masked}
                        </p>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex flex-wrap items-start gap-2">
                          <button
                            type="button"
                            onClick={() => void onToggleFavorite(secret.id)}
                            disabled={isBusy}
                            aria-label={secret.favorite ? `Remove ${secret.name} from favorites` : `Favorite ${secret.name}`}
                            className="h-8 w-8 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-sm text-amber-600 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {secret.favorite ? "★" : "☆"}
                          </button>
                          <select
                            value={secret.folder || "General"}
                            onChange={(event) => void onMoveSecret(secret.id, event.target.value)}
                            disabled={isBusy}
                            aria-label={`Move ${secret.name} to folder`}
                            className="max-w-full rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs font-medium text-[#0a66c2] outline-none focus:border-[#0a66c2] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {folderNames.map((folder) => (
                              <option key={folder} value={folder}>
                                Move to: {folder}
                              </option>
                            ))}
                          </select>
                          {(secret.folder || "General") !== "General" && (
                            <button
                              type="button"
                              onClick={() => void onRemoveFromFolder(secret.id)}
                              disabled={isBusy}
                              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Remove
                            </button>
                          )}
                          <button
                            onClick={() => setVisibleSecretId((current) => (current === secret.id ? null : secret.id))}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-slate-50"
                          >
                            {isRevealed ? "Hide" : "Reveal"}
                          </button>
                          <button
                            onClick={() => onCopy(secret)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-slate-50"
                          >
                            {copiedId === secret.id ? "Copied" : "Copy"}
                          </button>
                          <button
                            onClick={() => onEdit(secret)}
                            className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-[#0a66c2] hover:bg-blue-100"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => onDelete(secret.id)}
                            className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700 hover:bg-red-100"
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


