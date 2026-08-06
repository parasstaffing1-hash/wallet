"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearWallet,
  hasStoredWallet,
  loadWallet,
  saveWallet,
  WalletSecret,
} from "../../lib/wallet";
import { getCurrentSession, logout } from "../../lib/auth";

type FormState = Omit<WalletSecret, "id" | "createdAt" | "updatedAt">;
type ImportableSecret = Omit<WalletSecret, "id" | "createdAt" | "updatedAt">;
type SecretRecord = { key: string; value: string };

const blankForm: FormState = {
  project: "",
  app: "",
  name: "",
  value: "",
  notes: "",
};

const inputClass =
  "mt-2 w-full rounded-xl border border-white/12 bg-white/[0.05] px-3.5 py-2.5 text-sm text-gray-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/20";

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

function shouldParseAsJson(filename: string): boolean {
  return (
    filename.toLowerCase().endsWith(".json") &&
    /(secret|api[_-]?key|apikey|token|credential|env|vault)/i.test(filename)
  );
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
  const [searchTerm, setSearchTerm] = useState("");
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [hasExistingVault, setHasExistingVault] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

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
    return secrets
      .filter((secret) => {
        if (projectFilter !== "all" && secret.project !== projectFilter) {
          return false;
        }
        if (!term) {
          return true;
        }
        const haystack = `${secret.project} ${secret.app} ${secret.name} ${secret.notes ?? ""}`.toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => new Date(b.updatedAt).valueOf() - new Date(a.updatedAt).valueOf());
  }, [searchTerm, projectFilter, secrets]);

  useEffect(() => {
    setHasExistingVault(hasStoredWallet());
  }, []);

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
    const input = importInputRef.current;
    if (!input) {
      return;
    }
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.setAttribute("multiple", "");
  }, []);

  const clearMessage = useCallback(() => {
    window.setTimeout(() => setMessage(null), 2800);
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
      setHasExistingVault(true);
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
        nextSecrets = secrets.map((item) =>
          item.id === editingId
            ? {
                ...item,
                project: form.project.trim(),
                app: form.app.trim(),
                name: form.name.trim(),
                value: form.value.trim(),
                notes: form.notes?.trim(),
                updatedAt: now,
              }
            : item
        );
      } else {
        nextSecrets = [
          ...secrets,
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
    setHasExistingVault(false);
    setMessageTone("ok");
    setMessage("Wallet cleared.");
    clearMessage();
  };

  const onImportFolder = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(event.target.files ?? []);
      if (!selectedFiles.length) {
        if (event.target instanceof HTMLInputElement) {
          event.target.value = "";
        }
        return;
      }

      setIsBusy(true);
      setMessage(null);

      try {
        const now = new Date().toISOString();
        const collected: ImportableSecret[] = [];
        for (const file of selectedFiles) {
          const relativePath = ((file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name).replace(
            /\\/g,
            "/"
          );
          const filename = file.name.toLowerCase();
          const isEnvFile = filename === ".env" || filename.startsWith(".env.");
          const shouldParse = isEnvFile || shouldParseAsJson(filename);
          if (!shouldParse) {
            continue;
          }

          const content = await file.text();
          const parsed = isEnvFile || filename.startsWith(".env.") ? parseEnvContent(content) : parseJsonContent(content);
          if (!parsed.length) {
            continue;
          }

          const project = inferProjectFromPath(relativePath);
          const app = inferAppFromPath(relativePath);

          for (const pair of parsed) {
            const secretName = pair.key.trim();
            const secretValue = pair.value.trim();
            if (!secretName || !secretValue) {
              continue;
            }
            collected.push({
              project,
              app,
              name: secretName,
              value: secretValue,
              notes: `Imported from ${relativePath}`,
            });
          }
        }

        if (!collected.length) {
          setMessageTone("error");
          setMessage("No supported secret files found in that folder.");
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
        setMessageTone("ok");
        setMessage(`Imported ${added} new secret(s), updated ${updated} secret(s).`);
      } catch (error) {
        setMessageTone("error");
        setMessage(error instanceof Error ? error.message : "Failed to import from folder.");
      } finally {
        setIsBusy(false);
        if (event.target instanceof HTMLInputElement) {
          event.target.value = "";
        }
      }
    },
    [persist, secrets]
  );

  const openFolderPicker = () => importInputRef.current?.click();
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
    logout();
    setIsLocked(true);
    setSecrets([]);
    router.replace("/auth");
  }, [router]);
  const messageClass =
    messageTone === "error"
      ? "border-red-400/30 bg-red-400/10 text-red-100"
      : messageTone === "ok"
        ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
        : "border-sky-300/20 bg-sky-300/10 text-sky-100";

  if (isLocked) {
    if (!isAuthChecked) {
      return (
        <section className="mx-auto max-w-2xl">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-7 shadow-2xl shadow-black/30 backdrop-blur">
            <p className="text-sm text-gray-300">Checking session...</p>
          </div>
        </section>
      );
    }
    return (
      <section className="mx-auto max-w-2xl">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-7 shadow-2xl shadow-black/30 backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">Secure Access</p>
          <h1 className="mt-3 text-3xl font-semibold">Project API Vault</h1>
          <p className="mt-2 text-sm text-gray-300">
            Unlock your local vault to add, edit, and filter secrets across projects. Data stays in your browser and is encrypted with your
            master password.
          </p>
          <p className="mt-2 text-xs text-gray-400">Signed in as {username}</p>
          {!hasExistingVault && (
            <div className="mt-4 rounded-xl border border-cyan-300/30 bg-cyan-300/10 p-3 text-sm text-cyan-100">
              No existing vault found. Set any password to create one.
            </div>
          )}
          {message && <p className={`mt-4 rounded-xl border p-3 text-sm ${messageClass}`}>{message}</p>}
          <label className="mt-6 block text-sm font-medium text-gray-300" htmlFor="masterPassword">
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
            onClick={onUnlock}
            disabled={isBusy}
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-4 py-2 font-semibold text-white shadow-lg shadow-cyan-500/30 transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? "Unlocking..." : "Unlock Wallet"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-black/30">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">Workspace</p>
            <h1 className="mt-1 text-3xl font-semibold">Project API Wallet</h1>
            <p className="mt-2 text-sm text-gray-300">Manage API keys, tokens, and secrets by project and app.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onSignOut}
              className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-gray-200 hover:bg-white/10"
            >
              Sign Out
            </button>
            <button
              onClick={() => setIsLocked(true)}
              className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-gray-200 hover:bg-white/10"
            >
              Lock Wallet
            </button>
            <button
              onClick={onClearVault}
              className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-100 hover:bg-red-500/20"
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
          <p className="text-sm font-semibold text-gray-200">Import secrets from folder</p>
          <p className="mt-2 text-sm text-gray-400">
            Upload a folder; we automatically parse <code>.env</code>, <code>.env.*</code>, and JSON files containing key/value pairs.
          </p>
          <button
            type="button"
            onClick={openFolderPicker}
            disabled={isBusy}
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? "Importing..." : "Import All Secrets"}
          </button>
          <button
            type="button"
            onClick={onImportClipboard}
            disabled={isBusy}
            className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? "Reading clipboard..." : "Paste & import from clipboard"}
          </button>
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
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search project, app, secret name or notes"
          />
        </div>

        <div className="mt-4 overflow-x-auto">
          {filteredSecrets.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-gray-400">
              No secrets found for this filter.
            </div>
          ) : (
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
                {filteredSecrets.map((secret) => {
                  const isRevealed = visibleSecrets[secret.id] ?? false;
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
                            onClick={() => setVisibleSecrets((prev) => ({ ...prev, [secret.id]: !isRevealed }))}
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
          )}
        </div>
      </section>
    </div>
  );
}


