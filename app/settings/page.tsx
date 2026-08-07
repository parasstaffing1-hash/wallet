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
      <span className="h-6 w-11 rounded-full bg-slate-200 transition peer-checked:bg-[#0a66c2] peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-blue-200"></span>
      <span
        className={`pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
      <span className="ml-3 text-sm text-slate-700">{label}</span>
    </label>
  );
}

function StatusChip({ tone, text }: { tone: "ok" | "warn" | "neutral"; text: string }) {
  const colors =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-700";
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
        <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
          <p className="text-sm text-slate-500">Checking session...</p>
        </div>
      </section>
    );
  }

  return (
    <div className="min-h-screen md:pl-72">
      <nav className="fixed inset-y-0 left-0 hidden w-72 border-r border-slate-200 bg-white p-6 shadow-sm md:flex md:flex-col md:gap-4">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-sm font-bold text-[#0a66c2]">[SEC]</div>
          <div>
            <p className="text-lg font-semibold text-slate-900">Lumina Secure</p>
            <p className="text-xs text-slate-500">Vault locked</p>
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
                    ? "bg-blue-50 text-[#0a66c2]"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="mt-auto space-y-2 border-t border-slate-200 pt-4">
          <button
            onClick={onSignOut}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Sign Out
          </button>
          <button
            onClick={() => router.replace("/wallet")}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Open API Vault
          </button>
        </div>
      </nav>

      <header className="fixed right-0 top-0 z-20 hidden h-16 w-[calc(100%-18rem)] items-center justify-end gap-4 border-b border-slate-200 bg-white px-8 md:flex">
        <button className="rounded-full bg-[#0a66c2] px-3 py-2 text-xs font-semibold text-white">Add Key</button>
        <button className="rounded-full border border-blue-200 px-3 py-2 text-xs text-[#0a66c2]">Unlock vault</button>
      </header>

      <main className="relative min-h-screen overflow-x-hidden p-4 pt-6 md:p-8 md:pt-24">
        <div className="absolute inset-0 -z-10 bg-[#f3f6f8]" />
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 lg:grid-cols-12">
          <section className="lg:col-span-4 space-y-6">
            <div>
              <h1 className="text-2xl font-semibold">Settings</h1>
              <p className="mt-1 text-sm text-slate-600">Manage your account, security, and local vault preferences.</p>
            </div>

            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium">Security Score</p>
                  <p className="mt-1 text-xs text-slate-500">Improve your local vault protection.</p>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-lg font-bold text-[#0a66c2]">{securityScore}</div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-semibold">Optional hardening</p>
                <p className="mt-1 text-xs text-amber-700">Add stronger local unlock options when you are ready.</p>
                <button className="mt-3 w-full rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100">
                  Enable Biometrics
                </button>
              </div>
            </article>
          </section>

          <section className="space-y-6 lg:col-span-8">
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-4">
                <p className="text-sm font-semibold">Profile Settings</p>
                <StatusChip text="Linked" tone="warn" />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-slate-500">Full Name</label>
                  <input
                    value={settings.fullName}
                    onChange={(event) => setSettings((prev) => ({ ...prev, fullName: event.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-blue-200 focus:ring-2"
                    placeholder="Jane Doe"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-[0.2em] text-slate-500">Email Address</label>
                  <input
                    value={settings.email}
                    onChange={(event) => setSettings((prev) => ({ ...prev, email: event.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-blue-200 focus:ring-2"
                    placeholder="you@company.com"
                  />
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">Signed in as {username}</p>
                <button
                  onClick={onProfileSave}
                  className="rounded-xl bg-[#0a66c2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#004182]"
                >
                  Save Profile
                </button>
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-4">
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
                <button className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  Change Master Password
                </button>
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-4">
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

            <article className="rounded-2xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
              <div className="md:flex md:items-center md:justify-between">
                <div className="max-w-xl">
                  <p className="text-sm font-semibold">Vault Export</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Export an encrypted backup payload (wallet and password blobs) with your current settings profile.
                  </p>
                </div>
                <button
                  onClick={exportVault}
                  disabled={isBusy}
                  className="mt-4 w-full rounded-xl bg-[#0a66c2] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#004182] disabled:cursor-not-allowed disabled:opacity-60 md:mt-0 md:w-auto"
                >
                  {isBusy ? "Exporting..." : "Export Vault Data"}
                </button>
              </div>
            </article>
          </section>
        </div>

        {message && (
          <p className="mx-auto mt-6 max-w-6xl rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
            {message}
          </p>
        )}
      </main>
    </div>
  );
}
