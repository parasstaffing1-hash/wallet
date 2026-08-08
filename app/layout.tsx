import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumina Secure",
  description: "Enterprise-grade API key vault for projects and apps",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="app-theme min-h-screen bg-[#f5f7fa] text-slate-900">
        <div className="min-h-screen bg-[#f5f7fa]">
          <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
            <Link href="/" className="group inline-flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0a66c2] text-xs font-bold text-white shadow-[0_8px_20px_-8px_rgba(10,102,194,.7)] transition-transform group-hover:-translate-y-0.5">
                LS
              </span>
              <span>
                <span className="block text-sm font-bold tracking-tight text-slate-900">Lumina Secure</span>
                <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Local-first vault</span>
              </span>
            </Link>
            <div className="hidden items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 sm:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,.12)]" />
              Offline & encrypted
            </div>
          </header>
          <div className="relative z-10 px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </div>
      </body>
    </html>
  );
}
