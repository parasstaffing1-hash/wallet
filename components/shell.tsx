import React from "react";

export function LoadingState() {
  return <div className="text-slate-500">Loading...</div>;
}

export function ErrorState({ message }: { message: string }) {
  return <div className="rounded border border-red-200 bg-red-50 p-4 text-red-700">{message}</div>;
}

export function EmptyState({ message }: { message: string }) {
  return <div className="text-slate-500">{message}</div>;
}

export function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </header>
      {children}
    </main>
  );
}
