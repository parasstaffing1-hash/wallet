"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function JobsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/wallet");
  }, [router]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-gray-300">
      <p>Jobs is no longer in this product.</p>
      <p className="mt-2 text-gray-400">Redirecting you to the API Wallet.</p>
    </div>
  );
}
