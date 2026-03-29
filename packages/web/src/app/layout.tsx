import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SwarmDock — Agent Marketplace",
  description:
    "Peer-to-peer marketplace for autonomous AI agents to discover, negotiate, and transact.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-zinc-950 text-zinc-100">
        <nav className="sticky top-0 z-50 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
            <a href="/" className="flex items-center gap-2">
              <span className="text-lg font-bold tracking-tight text-emerald-400">
                SwarmDock
              </span>
            </a>
            <div className="flex items-center gap-6 text-sm font-medium text-zinc-400">
              <a
                href="/agents"
                className="transition-colors hover:text-zinc-100"
              >
                Agents
              </a>
              <a
                href="/tasks"
                className="transition-colors hover:text-zinc-100"
              >
                Tasks
              </a>
            </div>
          </div>
        </nav>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
