"use client";

import { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearPasswordKeyCache, clearPasswords, hasStoredPasswords, loadPasswords, PasswordEntry, savePasswords } from "../../lib/passwords";
import { getCurrentSession, logout } from "../../lib/auth";

type PasswordForm = Omit<PasswordEntry, "id" | "createdAt" | "updatedAt">;

const fieldClass =
  "mt-2 w-full rounded-xl border border-white/12 bg-white/[0.05] px-3.5 py-2.5 text-sm text-gray-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/20";

const PAGE_SIZE = 75;

const blankPassword: PasswordForm = {
  title: "",
  username: "",
  password: "",
  website: "",
  notes: "",
};

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

export default function PasswordManagerPage() {
  const router = useRouter();
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [username, setUsername] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"info" | "ok" | "error">("info");
  const [isBusy, setIsBusy] = useState(false);
  const [isLocked, setIsLocked] = useState(true);
  const [entries, setEntries] = useState<PasswordEntry[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [visiblePasswordId, setVisiblePasswordId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PasswordForm>(blankPassword);
  const [page, setPage] = useState(1);
  const clearNoticeTimerRef = useRef<number | null>(null);

  const messageClass =
    messageTone === "error"
      ? "border-red-400/30 bg-red-400/10 text-red-100"
      : messageTone === "ok"
        ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
        : "border-sky-300/20 bg-sky-300/10 text-sky-100";

  useEffect(() => {
    const session = getCurrentSession();
    if (!session) {
      router.replace("/auth");
      return;
    }
    setUsername(session.username);
    setIsAuthChecked(true);
    setMessage(hasStoredPasswords() ? null : "No password store found. Set any master password to create a new vault.");
  }, [router]);

  const filteredEntries = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      return entries;
    }
    return entries.filter((entry) => {
      const haystack = `${entry.title} ${entry.username} ${entry.website ?? ""} ${entry.notes ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [entries, searchTerm]);

  const visiblePage = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredEntries.slice(start, start + PAGE_SIZE);
  }, [filteredEntries, page]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));

  const clearNotice = useCallback(() => {
    if (clearNoticeTimerRef.current !== null) {
      window.clearTimeout(clearNoticeTimerRef.current);
    }
    clearNoticeTimerRef.current = window.setTimeout(() => {
      setMessage(null);
      clearNoticeTimerRef.current = null;
    }, 2600);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchTerm(searchInput);
      setPage(1);
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    return () => {
      if (clearNoticeTimerRef.current !== null) {
        window.clearTimeout(clearNoticeTimerRef.current);
      }
    };
  }, []);

  const persist = useCallback(
    async (nextEntries: PasswordEntry[]) => {
      await savePasswords(masterPassword, nextEntries);
      setEntries(nextEntries);
      setMessageTone("ok");
      setMessage("Password vault updated.");
      clearNotice();
    },
    [masterPassword, clearNotice]
  );

  const onUnlock = useCallback(async () => {
    if (!masterPassword.trim()) {
      setMessageTone("error");
      setMessage("Enter master password to open your credential vault.");
      return;
    }

    setIsBusy(true);
    setMessage(null);
    try {
      const loaded = await loadPasswords(masterPassword);
      setEntries(loaded);
      setIsLocked(false);
      setPage(1);
      setVisiblePasswordId(null);
      setMessageTone("ok");
      setMessage("Password manager unlocked.");
      clearNotice();
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to unlock password vault.");
    } finally {
      setIsBusy(false);
    }
  }, [clearNotice, masterPassword]);

  const resetForm = () => {
    setEditingId(null);
    setForm(blankPassword);
  };

  const onSave = useCallback(async () => {
    if (!form.title.trim() || !form.username.trim() || !form.password.trim()) {
      setMessageTone("error");
      setMessage("Service title, username, and password are required.");
      return;
    }

    setIsBusy(true);
    try {
      const now = new Date().toISOString();
      let nextEntries: PasswordEntry[];
      if (editingId) {
        const edited = entries.find((entry) => entry.id === editingId);
        if (!edited) {
          throw new Error("Credential not found.");
        }
        nextEntries = [
          {
            ...edited,
            title: form.title.trim(),
            username: form.username.trim(),
            password: form.password.trim(),
            website: form.website?.trim() || "",
            notes: form.notes?.trim(),
            updatedAt: now,
          },
          ...entries.filter((entry) => entry.id !== editingId),
        ];
      } else {
        nextEntries = [
          {
            id: crypto.randomUUID(),
            title: form.title.trim(),
            username: form.username.trim(),
            password: form.password.trim(),
            website: form.website?.trim() || "",
            notes: form.notes?.trim(),
            createdAt: now,
            updatedAt: now,
          },
          ...entries,
        ];
      }

      await persist(nextEntries);
      resetForm();
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Failed to save password entry.");
    } finally {
      setIsBusy(false);
    }
  }, [editingId, entries, form, persist]);

  const onEdit = (entry: PasswordEntry) => {
    setEditingId(entry.id);
    setForm({
      title: entry.title,
      username: entry.username,
      password: entry.password,
      website: entry.website ?? "",
      notes: entry.notes ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onDelete = useCallback(
    async (id: string) => {
      const ok = window.confirm("Delete this credential?");
      if (!ok) {
        return;
      }
      setIsBusy(true);
      try {
        const nextEntries = entries.filter((entry) => entry.id !== id);
        await persist(nextEntries);
        if (editingId === id) {
          resetForm();
        }
        if (visiblePasswordId === id) {
          setVisiblePasswordId(null);
        }
      } catch (error) {
        setMessageTone("error");
        setMessage(error instanceof Error ? error.message : "Failed to delete credential.");
      } finally {
        setIsBusy(false);
      }
    },
    [editingId, entries, persist]
  );

  const onCopy = async (entry: PasswordEntry) => {
    await navigator.clipboard.writeText(entry.password);
    setCopiedId(entry.id);
    window.setTimeout(() => setCopiedId((current) => (current === entry.id ? null : current)), 1200);
  };

  const onPasteIntoField = useCallback(
    async (field: keyof PasswordForm) => {
      try {
        const text = await navigator.clipboard.readText();
        setForm((prev) => ({
          ...prev,
          [field]: text.trim(),
        }));
      } catch {
        setMessageTone("error");
        setMessage("Unable to read clipboard.");
        clearNotice();
      }
    },
    [clearNotice]
  );

  const onSignOut = useCallback(() => {
    clearPasswordKeyCache();
    logout();
    setIsLocked(true);
    setEntries([]);
    setVisiblePasswordId(null);
    setCopiedId(null);
    setPage(1);
    router.replace("/auth");
  }, [router]);

  const onLock = useCallback(() => {
    clearPasswordKeyCache();
    setMasterPassword("");
    setEntries([]);
    setVisiblePasswordId(null);
    setCopiedId(null);
    setPage(1);
    setIsLocked(true);
  }, []);

  if (!isAuthChecked) {
    return (
      <section className="mx-auto max-w-2xl">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-7 shadow-2xl shadow-black/30 backdrop-blur">
          <p className="text-sm text-gray-300">Checking session...</p>
        </div>
      </section>
    );
  }

  if (isLocked) {
    return (
      <section className="mx-auto max-w-2xl">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-7 shadow-2xl shadow-black/30 backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">Password Vault</p>
          <h1 className="mt-3 text-3xl font-semibold">Password Manager</h1>
          <p className="mt-2 text-sm text-gray-300">
            Keep client logins, admin credentials, and service passwords in encrypted local storage.
          </p>
          <p className="mt-2 text-xs text-gray-400">Signed in as {username}</p>
          {message && <p className={`mt-4 rounded-xl border p-3 text-sm ${messageClass}`}>{message}</p>}
          <label className="mt-5 block text-sm font-medium text-gray-300" htmlFor="pmPassword">
            Master Password
          </label>
          <input
            id="pmPassword"
            type="password"
            className={fieldClass}
            value={masterPassword}
            onChange={(event) => setMasterPassword(event.target.value)}
            placeholder="Enter password..."
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                onUnlock();
              }
            }}
          />
          <button
            onClick={onUnlock}
            disabled={isBusy}
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-4 py-2 font-semibold text-white shadow-lg shadow-cyan-500/30 transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? "Unlocking..." : "Unlock Password Manager"}
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
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">Secure Notes</p>
            <h1 className="mt-1 text-3xl font-semibold">Password Manager</h1>
            <p className="mt-2 text-sm text-gray-300">Store credentials per service in your browser, encrypted locally.</p>
            <p className="mt-1 text-xs text-gray-400">Signed in as {username}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onSignOut}
              className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-gray-200 hover:bg-white/10"
            >
              Sign Out
            </button>
            <button
              onClick={onLock}
              className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-gray-200 hover:bg-white/10"
            >
              Lock
            </button>
            <button
              onClick={() => {
                setMasterPassword("");
                clearPasswords();
                setEntries([]);
                setMessageTone("info");
                setMessage("Password vault cleared.");
                clearNotice();
              }}
              className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-2 text-sm text-red-100 hover:bg-red-400/20"
            >
              Clear All
            </button>
          </div>
        </div>
        {message && <p className={`mt-4 rounded-xl border p-3 text-sm ${messageClass}`}>{message}</p>}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-gray-400">Total Credentials</p>
            <p className="mt-3 text-2xl font-semibold">{entries.length}</p>
          </article>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-5">
        <article className="lg:col-span-2 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-sm font-semibold text-gray-200">Search credentials</p>
          <input
            className={`${fieldClass} mb-2`}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search service / username / note..."
          />
          <p className="mt-2 text-sm text-gray-400">
            Store everything you need to open services fast. Password values remain hidden until revealed.
          </p>
        </article>

        <article className="lg:col-span-3 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-sm font-semibold text-gray-200">{editingId ? "Update Credential" : "Add Credential"}</p>

          <div className="mt-4">
            <label className="text-sm text-gray-300" htmlFor="service">
              Service / Title
            </label>
            <input
              id="service"
              className={fieldClass}
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="GitHub, Stripe, AWS..."
            />
            <button
              type="button"
              onClick={() => onPasteIntoField("title")}
              className="mt-2 inline-flex h-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-4 text-xs font-semibold text-gray-200 hover:bg-white/10"
            >
              Paste title
            </button>
          </div>

          <div className="mt-4">
            <label className="text-sm text-gray-300" htmlFor="pm-username">
              Username / Email
            </label>
            <input
              id="pm-username"
              className={fieldClass}
              value={form.username}
              onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
              placeholder="you@domain.com"
            />
            <button
              type="button"
              onClick={() => onPasteIntoField("username")}
              className="mt-2 inline-flex h-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-4 text-xs font-semibold text-gray-200 hover:bg-white/10"
            >
              Paste username
            </button>
          </div>

          <div className="mt-4">
            <label className="text-sm text-gray-300" htmlFor="pm-password">
              Password
            </label>
            <input
              id="pm-password"
              type="password"
              className={fieldClass}
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              placeholder="********"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => onPasteIntoField("password")}
              className="mt-2 inline-flex h-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-4 text-xs font-semibold text-gray-200 hover:bg-white/10"
            >
              Paste password
            </button>
          </div>

          <div className="mt-4">
            <label className="text-sm text-gray-300" htmlFor="pm-website">
              Website (optional)
            </label>
            <input
              id="pm-website"
              className={fieldClass}
              value={form.website}
              onChange={(event) => setForm((prev) => ({ ...prev, website: event.target.value }))}
              placeholder="https://..."
            />
          </div>

          <div className="mt-4">
            <label className="text-sm text-gray-300" htmlFor="pm-notes">
              Notes (optional)
            </label>
            <textarea
              id="pm-notes"
              rows={3}
              className={fieldClass}
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="MFA required, shared account, rotation date..."
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={onSave}
              disabled={isBusy}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/30 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isBusy ? "Saving..." : editingId ? "Save Changes" : "Save Credential"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 text-sm font-semibold text-gray-200 hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </article>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
        {filteredEntries.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-gray-400">
            No credentials found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full table-fixed border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.12em] text-gray-400">
                  <th className="w-2/7 px-4 py-3">Service</th>
                  <th className="w-1/6 px-4 py-3">Username</th>
                  <th className="w-2/7 px-4 py-3">Password</th>
                  <th className="w-2/6 px-4 py-3">Last Updated</th>
                  <th className="w-1/5 px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visiblePage.map((entry) => {
                  const isVisible = visiblePasswordId === entry.id;
                  const masked = "*".repeat(Math.min(18, Math.max(8, entry.password.length || 8)));
                  return (
                    <tr key={entry.id} className="border-t border-white/10">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-100">{entry.title}</p>
                        {entry.website && <p className="mt-1 text-xs text-gray-400">{entry.website}</p>}
                        {entry.notes && <p className="mt-1 text-xs text-gray-400">{entry.notes}</p>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">{entry.username}</td>
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs text-gray-300 break-all">
                          {isVisible ? entry.password : masked}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{shortTime(entry.updatedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => setVisiblePasswordId((current) => (current === entry.id ? null : entry.id))}
                            className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-gray-200 hover:bg-white/10"
                          >
                            {isVisible ? "Hide" : "Reveal"}
                          </button>
                          <button
                            onClick={() => onCopy(entry)}
                            className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-gray-200 hover:bg-white/10"
                          >
                            {copiedId === entry.id ? "Copied" : "Copy"}
                          </button>
                          <button
                            onClick={() => onEdit(entry)}
                            className="rounded-lg border border-cyan-400/30 bg-cyan-300/10 px-2.5 py-1.5 text-xs text-cyan-100 hover:bg-cyan-300/20"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => onDelete(entry.id)}
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
            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-gray-400">
              <span>
                Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filteredEntries.length)} of {filteredEntries.length}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-gray-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="flex items-center px-1">Page {page} of {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page === totalPages}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-gray-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
