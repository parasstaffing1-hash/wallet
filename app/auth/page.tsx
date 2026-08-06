"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createAccount, getCurrentSession, hasStoredAccounts, login } from "../../lib/auth";

const fieldClass =
  "mt-2 w-full rounded-xl border border-white/12 bg-white/[0.05] px-3.5 py-2.5 text-sm text-gray-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/20";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "create">("create");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [hasAccounts, setHasAccounts] = useState(false);

  useEffect(() => {
    const hasUsers = hasStoredAccounts();
    setHasAccounts(hasUsers);
    if (!hasUsers) {
      setMode("create");
    } else if (getCurrentSession()) {
      router.replace("/wallet");
    }
  }, [router]);

  const submitLabel = useMemo(() => (mode === "create" ? "Create account" : "Sign in"), [mode]);

  const onSubmit = async () => {
    if (!username.trim() || !password) {
      setMessage("Username and password are required.");
      return;
    }

    if (mode === "create") {
      if (password.length < 6) {
        setMessage("Password must be at least 6 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setMessage("Passwords do not match.");
        return;
      }
    }

    setIsBusy(true);
    setMessage(null);

    try {
      let error: string | null = null;
      if (mode === "create") {
        error = await createAccount(username, password);
      } else {
        error = await login(username, password);
      }
      if (error) {
        setMessage(error);
        return;
      }
      router.replace("/wallet");
    } finally {
      setIsBusy(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === "create" ? "signin" : "create");
    setMessage(null);
    setConfirmPassword("");
  };

  return (
    <main className="mx-auto max-w-xl">
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-black/30">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">Offline Identity</p>
        <h1 className="mt-3 text-3xl font-semibold">
          {mode === "create" ? "Create your account" : "Sign in to VaultFlow"}
        </h1>
        <p className="mt-2 text-sm text-gray-300">
          This project works entirely offline and stores account credentials in this browser.
        </p>

        {message && (
          <p className="mt-4 rounded-xl border border-red-400/40 bg-red-400/10 px-4 py-2 text-sm text-red-100">
            {message}
          </p>
        )}

        <div className="mt-5">
          <label className="text-sm text-gray-300" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className={fieldClass}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="you@company.com"
          />
        </div>

        <div className="mt-4">
          <label className="text-sm text-gray-300" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className={fieldClass}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="********"
            autoComplete="off"
          />
        </div>

        {mode === "create" && (
          <div className="mt-4">
            <label className="text-sm text-gray-300" htmlFor="confirmPassword">
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              className={fieldClass}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="********"
              autoComplete="off"
            />
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={onSubmit}
            disabled={isBusy}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/30 transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? "Please wait..." : submitLabel}
          </button>
          {hasAccounts && (
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-2 text-sm font-semibold text-gray-200 hover:bg-white/10"
              onClick={toggleMode}
            >
              {mode === "create" ? "Have an account? Sign in" : "Need a new account? Create one"}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
