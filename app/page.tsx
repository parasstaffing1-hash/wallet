import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl">
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl shadow-black/30 backdrop-blur sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">Secure Infrastructure</p>
        <h1 className="mt-4 max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          One place to manage project API secrets.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-gray-300 sm:text-lg">
          VaultFlow keeps secrets in your browser, encrypted locally, with project-first organization, quick filtering, and import from
          repo folders so you can restore after cleaning local files.
        </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/auth"
          className="inline-flex h-12 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-sm font-semibold text-gray-200 transition-colors hover:bg-white/10"
        >
          Open Login / Create Account
        </Link>
        <Link
          href="/wallet"
          className="inline-flex h-12 items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-6 text-sm font-semibold text-white shadow-lg shadow-cyan-500/30"
        >
          Open API Wallet
        </Link>
        <Link
          href="/passwords"
          className="inline-flex h-12 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-sm font-semibold text-gray-200 transition-colors hover:bg-white/10"
        >
          Open Password Manager
        </Link>
        <Link
          href="/settings"
          className="inline-flex h-12 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-sm font-semibold text-gray-200 transition-colors hover:bg-white/10"
        >
          Open Settings
        </Link>
      </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-sm text-gray-400">Vault behavior</p>
          <p className="mt-2 text-lg font-semibold">Local-by-default encryption</p>
          <p className="mt-2 text-sm text-gray-400">Secrets are encrypted using a password-derived AES key and never sent to a server.</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-sm text-gray-400">Organization model</p>
          <p className="mt-2 text-lg font-semibold">Project to App to Secret</p>
          <p className="mt-2 text-sm text-gray-400">Keep multi-client and multi-service credentials cleanly segmented.</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-sm text-gray-400">Import engine</p>
          <p className="mt-2 text-lg font-semibold">Folder-to-vault ingestion</p>
          <p className="mt-2 text-sm text-gray-400">Drop an entire folder of .env / .env.* / secrets JSON files and auto-merge.</p>
        </article>
      </section>
    </main>
  );
}
