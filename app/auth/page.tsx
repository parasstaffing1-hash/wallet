"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createAccount, getCurrentSession, hasStoredAccounts, login, MIN_ACCOUNT_PASSWORD_LENGTH } from "../../lib/auth";

const fieldClass =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#0a66c2] focus:ring-2 focus:ring-[#0a66c2]/20";

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
      if (password.length < MIN_ACCOUNT_PASSWORD_LENGTH) {
        setMessage(`Password must be at least ${MIN_ACCOUNT_PASSWORD_LENGTH} characters.`);
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
      <section className="rounded-[28px] border border-slate-200 bg-white p-7 shadow-[0_24px_70px_-42px_rgba(15,23,42,.42)] sm:p-9">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#0a66c2]">Offline identity</p>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em] text-slate-950">
          {mode === "create" ? "Create your account" : "Sign in to VaultFlow"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          This project works entirely offline and stores account credentials in this browser.
        </p>

        {message && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {message}
          </p>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
        >
        <div className="mt-5">
          <label className="text-sm font-medium text-slate-700" htmlFor="username">
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
          <label className="text-sm font-medium text-slate-700" htmlFor="password">
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
            <label className="text-sm font-medium text-slate-700" htmlFor="confirmPassword">
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
            type="submit"
            disabled={isBusy}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-[#0a66c2] px-5 py-2 text-sm font-semibold text-white shadow-[0_12px_28px_-18px_rgba(10,102,194,.7)] transition hover:bg-[#004182] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? "Please wait..." : submitLabel}
          </button>
          {hasAccounts && (
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-[#0a66c2]"
              onClick={toggleMode}
            >
              {mode === "create" ? "Have an account? Sign in" : "Need a new account? Create one"}
            </button>
          )}
        </div>
        </form>
      </section>
    </main>
  );
}
