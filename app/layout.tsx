import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumina Secure",
  description: "Enterprise-grade API key vault for projects and apps",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-white">
        <div className="relative min-h-screen overflow-hidden bg-slate-950">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_5%_10%,_#1e293b_0%,_transparent_55%),radial-gradient(circle_at_90%_20%,_#3730a3_0%,_transparent_45%),radial-gradient(circle_at_50%_100%,_#0f766e_0%,_transparent_55%)] opacity-60" />
          <div className="relative z-10 px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </div>
      </body>
    </html>
  );
}
