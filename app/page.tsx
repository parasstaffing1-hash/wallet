import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl">
      <section className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-[0_24px_70px_-42px_rgba(15,23,42,.42)] sm:p-12">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#0a66c2]">Secure infrastructure</p>
        <h1 className="mt-4 max-w-2xl text-4xl font-bold tracking-[-0.04em] text-slate-950 sm:text-5xl">
          One place to manage project API secrets.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
          VaultFlow keeps secrets in your browser, encrypted locally, with project-first organization, quick filtering, and import from
          repo folders so you can restore after cleaning local files.
        </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/auth"
          className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#0a66c2]"
        >
          Open Login / Create Account
        </Link>
        <Link
          href="/wallet"
          className="inline-flex h-12 items-center justify-center rounded-xl bg-[#0a66c2] px-6 text-sm font-semibold text-white shadow-[0_12px_28px_-18px_rgba(10,102,194,.7)] transition-colors hover:bg-[#004182]"
        >
          Open API Wallet
        </Link>
        <Link
          href="/passwords"
          className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#0a66c2]"
        >
          Open Password Manager
        </Link>
        <Link
          href="/settings"
          className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#0a66c2]"
        >
          Open Settings
        </Link>
      </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0a66c2]">Vault behavior</p>
          <p className="mt-3 text-lg font-semibold text-slate-900">Local-by-default encryption</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">Secrets are encrypted using a password-derived AES key and never sent to a server.</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0a66c2]">Organization model</p>
          <p className="mt-3 text-lg font-semibold text-slate-900">Project to App to Secret</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">Keep multi-client and multi-service credentials cleanly segmented.</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0a66c2]">Import engine</p>
          <p className="mt-3 text-lg font-semibold text-slate-900">Folder-to-vault ingestion</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">Drop an entire folder of .env / .env.* / secrets JSON files and auto-merge.</p>
        </article>
      </section>
    </main>
  );
}
