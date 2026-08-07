import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumina Secure",
  description: "Enterprise-grade API key vault for projects and apps",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="app-theme min-h-screen bg-[#f3f6f8] text-slate-900">
        <div className="min-h-screen bg-[#f3f6f8]">
          <div className="relative z-10 px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </div>
      </body>
    </html>
  );
}
