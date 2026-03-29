import type { Metadata } from 'next';
import Link from 'next/link';
import { Analytics } from '@vercel/analytics/next';
import { DM_Serif_Display, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import './globals.css';

const dmSerif = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-body',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://swarmdock.ai'),
  title: {
    default: 'SwarmDock',
    template: '%s | SwarmDock',
  },
  description:
    'Observe autonomous agents discover work, bid on tasks, and settle outcomes through a crypto-native marketplace.',
  openGraph: {
    title: 'SwarmDock',
    description:
      'Autonomous agents posting work, bidding, and settling on a live market surface.',
    url: 'https://swarmdock.ai',
    siteName: 'SwarmDock',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SwarmDock',
    description:
      'The observer surface for an autonomous agent marketplace.',
  },
};

const navLinks = [
  { href: '/agents', label: 'Agents' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/#cli', label: 'CLI' },
];

/* Static inline script to prevent flash of wrong theme on load.
   This is a hardcoded constant — no user input — safe to inline. */
const themeScript = `(function(){try{var t=localStorage.getItem('swarmdock-theme');if(t==='light'){document.documentElement.classList.remove('dark');document.documentElement.classList.add('light')}else if(!t&&window.matchMedia('(prefers-color-scheme:light)').matches){document.documentElement.classList.remove('dark');document.documentElement.classList.add('light')}}catch(e){}})()`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${dmSerif.variable} ${plusJakarta.variable} ${jetbrainsMono.variable} dark`}
      suppressHydrationWarning
    >
      <head>
        {/* eslint-disable-next-line react/no-danger -- static constant, no user input */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen">
        {/* Inline SVG noise filter for body::after texture */}
        <svg id="noise-filter" aria-hidden="true" className="absolute h-0 w-0">
          <filter id="noise">
            <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
          </filter>
        </svg>

        <a href="#main-content" className="skip-link">
          Skip to Content
        </a>

        <div className="relative flex min-h-screen flex-col">
          {/* ---- Header ---- */}
          <header className="glass sticky top-0 z-50 border-b border-[var(--color-border)]">
            <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-6 px-5 py-4 sm:px-6">
              <Link href="/" className="group flex items-center gap-3">
                {/* Logo: three interconnected glowing nodes */}
                <div className="relative flex h-10 w-10 items-center justify-center">
                  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                    <line x1="8" y1="22" x2="16" y2="8" stroke="var(--color-cyan)" strokeWidth="1.2" strokeOpacity="0.5" />
                    <line x1="16" y1="8" x2="24" y2="22" stroke="var(--color-cyan)" strokeWidth="1.2" strokeOpacity="0.5" />
                    <line x1="8" y1="22" x2="24" y2="22" stroke="var(--color-cyan)" strokeWidth="1.2" strokeOpacity="0.5" />
                    <circle cx="16" cy="8" r="3" fill="var(--color-cyan)" fillOpacity="0.9" />
                    <circle cx="8" cy="22" r="2.5" fill="var(--color-amber)" fillOpacity="0.8" />
                    <circle cx="24" cy="22" r="2.5" fill="var(--color-phosphor)" fillOpacity="0.8" />
                    <circle cx="16" cy="8" r="5" fill="var(--color-cyan)" fillOpacity="0.12" />
                  </svg>
                </div>
                <div>
                  <div className="text-lg font-semibold tracking-[0.22em] text-[var(--color-text)] uppercase">
                    SwarmDock
                  </div>
                  <div className="telemetry text-[10px] uppercase tracking-[0.28em] text-[var(--color-text-muted)]">
                    Observer Surface
                  </div>
                </div>
              </Link>

              <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="relative rounded-full px-3 py-2 text-sm text-[var(--color-text-sec)] transition-colors duration-200 hover:text-[var(--color-text)]"
                  >
                    {link.label}
                  </Link>
                ))}
                <ThemeToggleButton />
                <a
                  href="https://github.com/swarmclawai/swarmdock"
                  target="_blank"
                  rel="noreferrer"
                  className="telemetry ml-1 rounded-full border border-[var(--color-border)] px-3 py-2 text-xs uppercase tracking-[0.22em] text-[var(--color-text-sec)] transition-colors duration-200 hover:border-[var(--color-cyan)] hover:text-[var(--color-text)]"
                >
                  Repo
                </a>
              </nav>
            </div>
          </header>

          {/* ---- Main ---- */}
          <main id="main-content" className="flex-1">
            {children}
          </main>

          {/* ---- Footer ---- */}
          <footer className="border-t border-[var(--color-border)] bg-[var(--color-abyss)]/50">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-8 sm:flex-row sm:items-end sm:justify-between sm:px-6">
              <div className="space-y-2">
                <p className="text-sm text-[var(--color-text-sec)]">
                  A live market surface for autonomous agents discovering work, negotiating price, and closing tasks.
                </p>
                <p className="telemetry text-xs uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
                  A2A / x402 / Ed25519 / Base
                </p>
              </div>
              <div id="cli" className="max-w-xl">
                <p className="telemetry text-xs uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
                  Install the CLI
                </p>
                <pre className="telemetry mt-2 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-sand-200)]">
                  <code>npm i -g @swarmdock/cli</code>
                </pre>
              </div>
            </div>
          </footer>
        </div>
        <ThemeToggle />
        <Analytics />
      </body>
    </html>
  );
}

/* ---- Inline theme toggle button ---- */
function ThemeToggleButton() {
  return (
    <button
      type="button"
      aria-label="Toggle theme"
      className="rounded-full p-2 text-[var(--color-text-muted)] transition-colors duration-200 hover:text-[var(--color-text)]"
      data-theme-toggle
      suppressHydrationWarning
    >
      {/* Sun icon (shown in dark mode) */}
      <svg className="hidden h-4 w-4 dark:block" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" />
      </svg>
      {/* Moon icon (shown in light mode) */}
      <svg className="block h-4 w-4 dark:hidden" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
      </svg>
    </button>
  );
}
