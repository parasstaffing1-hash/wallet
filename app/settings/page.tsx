"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentSession, logout } from "../../lib/auth";

type SettingPayload = {
  fullName: string;
  email: string;
  useAuthenticator: boolean;
  useBiometrics: boolean;
  useSmsRecovery: boolean;
  emailAlerts: boolean;
  pushAlerts: boolean;
  desktopPrompts: boolean;
};

const STORAGE_KEY = "lumina-settings:v1";
const defaultSettings: SettingPayload = {
  fullName: "",
  email: "",
  useAuthenticator: false,
  useBiometrics: false,
  useSmsRecovery: false,
  emailAlerts: true,
  pushAlerts: false,
  desktopPrompts: true,
};

const navItems = [
  { href: "/wallet", label: "API Vault", icon: "[KV]", id: "vault" },
  { href: "/passwords", label: "Passwords", icon: "[PW]", id: "passwords" },
  { href: "/settings", label: "Settings", icon: "[SET]", id: "settings" },
];

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className="w-11 h-6 rounded-full bg-white/20 transition peer-checked:bg-cyan-400 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-300/80"></span>
      <span
        className={`pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
      <span className="ml-3 text-sm text-slate-200">{label}</span>
    </label>
  );
}

function StatusChip({ tone, text }: { tone: "ok" | "warn" | "neutral"; text: string }) {
  const colors =
    tone === "ok"
      ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-100"
      : tone === "warn"
        ? "bg-amber-500/20 border-amber-400/40 text-amber-100"
        : "bg-slate-500/20 border-slate-400/40 text-slate-100";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${colors}`}>{text}</span>;
}

export default function SettingsPage() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [settings, setSettings] = useState<SettingPayload>(defaultSettings);

  const [isAuthChecked, setIsAuthChecked] = useState(false);

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
    if (!isAuthChecked) {
      return;
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<SettingPayload>;
      setSettings((current) => ({
        ...current,
        ...parsed,
      }));
    } catch {
      // keep defaults if this data is invalid
    }
  }, [isAuthChecked]);

  const saveSettings = useCallback(
    (next: SettingPayload) => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSettings(next);
      setMessage("Settings saved.");
      window.setTimeout(() => setMessage(null), 2000);
    },
    [setSettings]
  );

  const onToggle = useCallback(
    (field: keyof SettingPayload, value: boolean) => {
      saveSettings({ ...settings, [field]: value });
    },
    [saveSettings, settings]
  );

  const onProfileSave = useCallback(() => {
    setMessage("Profile settings updated.");
    window.setTimeout(() => setMessage(null), 1700);
    saveSettings(settings);
  }, [saveSettings, settings]);

  const securityScore = useMemo(() => {
    let score = 34;
    if (settings.useAuthenticator) {
      score += 20;
    }
    if (settings.useBiometrics) {
      score += 26;
    }
    if (settings.useSmsRecovery) {
      score += 10;
    }
    return Math.min(score, 100);
  }, [settings.useAuthenticator, settings.useBiometrics, settings.useSmsRecovery]);

  const exportVault = useCallback(() => {
    setIsBusy(true);
    setMessage(null);
    try {
      const walletBlob = window.localStorage.getItem("myapp-wallet:v1");
      const passwordsBlob = window.localStorage.getItem("vaultflow-passwords:v1");
      const payload = {
        exportedAt: new Date().toISOString(),
        account: username,
        settings: settings,
        wallet: walletBlob ? JSON.parse(walletBlob) : null,
        passwords: passwordsBlob ? JSON.parse(passwordsBlob) : null,
      };

      const text = JSON.stringify(payload, null, 2);
      const file = new Blob([text], { type: "application/json" });
      const href = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = href;
      link.download = `lumina-export-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(href);
      setMessage("Export downloaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not export vault payload.");
    } finally {
      setIsBusy(false);
      window.setTimeout(() => setMessage(null), 2300);
    }
  }, [username, settings]);

  const onSignOut = useCallback(() => {
    logout();
    router.replace("/auth");
  }, [router]);

  if (!isAuthChecked) {
    return (
      <section className="mx-auto mt-16 max-w-5xl px-4">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-7 shadow-lg">
          <p className="text-sm text-slate-300">Checking session...</p>
        </div>
      </section>
    );
  }

  return (
    <div className="min-h-screen md:pl-72">
      <nav className="fixed inset-y-0 left-0 hidden w-72 border-r border-white/10 bg-slate-900/70 p-6 backdrop-blur md:flex md:flex-col md:gap-4">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-200">[SEC]</div>
          <div>
            <p className="text-lg font-semibold">Lumina Secure</p>
            <p className="text-xs text-slate-300">Vault Locked</p>
          </div>
        </div>

        <div className="space-y-2">
          {navItems.map((item) => {
            const active = item.id === "settings";
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition ${
                  active
                    ? "bg-cyan-500/20 text-cyan-100"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="mt-auto space-y-2 border-t border-white/10 pt-4">
          <button
            onClick={onSignOut}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-left text-sm text-slate-200 hover:bg-white/10"
          >
            Sign Out
          </button>
          <button
            onClick={() => router.replace("/wallet")}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-left text-sm text-slate-200 hover:bg-white/10"
          >
            Open API Vault
          </button>
        </div>
      </nav>

      <header className="hidden md:flex fixed top-0 right-0 z-20 flex h-16 w-[calc(100%-18rem)] items-center justify-end gap-4 border-b border-white/10 bg-slate-950/70 px-8 backdrop-blur">
        <button className="rounded-full bg-cyan-500 px-3 py-2 text-xs font-semibold text-white">Add Key</button>
        <button className="rounded-full border border-cyan-300/60 px-3 py-2 text-xs text-cyan-200">Unlock Vault</button>
      </header>

      <main className="relative min-h-screen overflow-x-hidden p-4 pt-6 md:p-8 md:pt-24">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-sky-100/10 via-slate-800/10 to-indigo-900/10" />
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 lg:grid-cols-12">
          <section className="lg:col-span-4 space-y-6">
            <div>
              <h1 className="text-2xl font-semibold">Settings</h1>
              <p className="mt-1 text-sm text-slate-300">Manage account preferences, security settings, and vault controls.</p>
            </div>

            <article className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_20px_40px_rgba(0,0,0,0.25)]">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium">Security Score</p>
                  <p className="mt-1 text-xs text-slate-400">Improve by enabling stronger lock and recovery options</p>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-lg font-bold text-white">{securityScore}</div>
              </div>
              <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                <p className="font-semibold">Action required</p>
                <p className="mt-1 text-xs text-amber-100/90">Enable biometric lock to secure local vault access.</p>
                <button className="mt-3 w-full rounded-full border border-amber-300/30 bg-amber-300/20 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-300/30">
                  Enable Biometrics
                </button>
              </div>
            </article>
          </section>

          <section className="space-y-6 lg:col-span-8">
            <article className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
                <p className="text-sm font-semibold">Profile Settings</p>
                <StatusChip text="Linked" tone="warn" />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-slate-400">Full Name</label>
                  <input
                    value={settings.fullName}
                    onChange={(event) => setSettings((prev) => ({ ...prev, fullName: event.target.value }))}
                    className="w-full rounded-xl border border-white/15 bg-slate-900/80 px-3 py-2.5 text-sm outline-none ring-cyan-300/40 focus:ring-2"
                    placeholder="Jane Doe"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-slate-400">Email Address</label>
                  <input
                    value={settings.email}
                    onChange={(event) => setSettings((prev) => ({ ...prev, email: event.target.value }))}
                    className="w-full rounded-xl border border-white/15 bg-slate-900/80 px-3 py-2.5 text-sm outline-none ring-cyan-300/40 focus:ring-2"
                    placeholder="you@company.com"
                  />
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-400">Signed in as {username}</p>
                <button
                  onClick={onProfileSave}
                  className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500/90"
                >
                  Save Profile
                </button>
              </div>
            </article>

            <article className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
                <p className="text-sm font-semibold">Security & 2FA</p>
                <StatusChip text="Hardening" tone="ok" />
              </div>
              <div className="space-y-6">
                <Toggle
                  checked={settings.useAuthenticator}
                  label="Authenticator app"
                  onChange={(value) => onToggle("useAuthenticator", value)}
                />
                <Toggle
                  checked={settings.useBiometrics}
                  label="Biometric unlock"
                  onChange={(value) => onToggle("useBiometrics", value)}
                />
                <Toggle
                  checked={settings.useSmsRecovery}
                  label="SMS recovery"
                  onChange={(value) => onToggle("useSmsRecovery", value)}
                />
                <button className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10">
                  Change Master Password
                </button>
              </div>
            </article>

            <article className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
                <p className="text-sm font-semibold">Notifications</p>
              </div>
              <div className="space-y-6">
                <Toggle
                  checked={settings.emailAlerts}
                  label="Email Alerts"
                  onChange={(value) => onToggle("emailAlerts", value)}
                />
                <Toggle
                  checked={settings.pushAlerts}
                  label="Push Notifications"
                  onChange={(value) => onToggle("pushAlerts", value)}
                />
                <Toggle
                  checked={settings.desktopPrompts}
                  label="Desktop Prompts"
                  onChange={(value) => onToggle("desktopPrompts", value)}
                />
              </div>
            </article>

            <article className="rounded-2xl border border-white/10 bg-gradient-to-r from-slate-900/80 to-slate-800/50 p-6 shadow-sm">
              <div className="md:flex md:items-center md:justify-between">
                <div className="max-w-xl">
                  <p className="text-sm font-semibold">Vault Export</p>
                  <p className="mt-1 text-xs text-slate-300">
                    Export an encrypted backup payload (wallet and password blobs) with your current settings profile.
                  </p>
                </div>
                <button
                  onClick={exportVault}
                  disabled={isBusy}
                  className="mt-4 w-full rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 md:mt-0 md:w-auto"
                >
                  {isBusy ? "Exporting..." : "Export Vault Data"}
                </button>
              </div>
            </article>
          </section>
        </div>

        {message && (
          <p className="mx-auto mt-6 max-w-6xl rounded-xl border border-cyan-300/30 bg-cyan-300/10 p-3 text-xs text-cyan-100">
            {message}
          </p>
        )}
      </main>
    </div>
  );
}
