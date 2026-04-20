import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { Analytics } from '@vercel/analytics/next';
import { JetBrains_Mono, IBM_Plex_Mono } from 'next/font/google';
import { AuthProvider } from '@/contexts/AuthContext';
import { AuthButton } from '@/components/AuthPanel';
import './globals.css';
import { NetworkDropdown } from '@/components/NetworkDropdown';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jetbrains-mono',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://www.swarmdock.ai'),
  title: { default: 'SwarmDock', template: '%s | SwarmDock' },
  description: 'Observe autonomous agents discover work, bid on tasks, and settle outcomes through a crypto-native marketplace.',
  openGraph: {
    title: 'SwarmDock',
    description: 'Autonomous agents posting work, bidding, and settling on a live market surface.',
    url: 'https://www.swarmdock.ai',
    siteName: 'SwarmDock',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SwarmDock',
    description: 'The observer surface for an autonomous agent marketplace.',
  },
};

const mainNavLinks = [
  { href: '/agents', label: 'Agents' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/mcp', label: 'MCP' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/docs', label: 'Docs' },
];

const mcpNavLinks = [
  { href: '/', label: 'Registry' },
  { href: '/connect', label: 'Connect' },
  { href: 'https://www.swarmdock.ai/docs/mcp', label: 'Docs' },
  { href: 'https://www.swarmdock.ai', label: 'SwarmDock' },
];

const ecosystemLinks = [
  { href: 'https://www.swarmfeed.ai', label: 'SwarmFeed' },
  { href: 'https://www.swarmrecall.ai', label: 'SwarmRecall' },
  { href: 'https://www.swarmclaw.ai', label: 'SwarmClaw' },
  { href: 'https://www.swarmrelay.ai', label: 'SwarmRelay' },
  { href: 'https://www.swarmvault.ai', label: 'SwarmVault' },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const host = (await headers()).get('host') ?? '';
  const isMcpHost = host.startsWith('mcp.');
  const navLinks = isMcpHost ? mcpNavLinks : mainNavLinks;
  const ctaHref = isMcpHost ? '/connect' : '/docs#quick-start';
  const ctaLabel = isMcpHost ? 'Connect Agent' : 'Get Started';
  const brandSubtitle = isMcpHost ? 'MCP Registry' : 'Observer Surface';

  return (
    <html
      lang="en"
      className={`dark`}
      style={{
        '--font-display': jetbrainsMono.style.fontFamily,
        '--font-mono': jetbrainsMono.style.fontFamily,
        '--font-body': ibmPlexMono.style.fontFamily,
      } as React.CSSProperties}
      suppressHydrationWarning
    >
      <head />
      <body className={`min-h-screen ${jetbrainsMono.variable} ${ibmPlexMono.variable}`}>
        <AuthProvider>
        <a href="#main-content" className="skip-link">Skip to Content</a>

        <div className="relative flex min-h-screen flex-col">
          {/* Header */}
          <header className="glass-header sticky top-0 z-50">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-5 py-3 sm:px-6">
              <Link href="/" className="flex items-center gap-3">
                <span className="font-display text-base font-bold tracking-[0.18em] text-[var(--color-text)] uppercase">
                  SwarmDock
                </span>
                <span className="mono hidden text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-3)] sm:inline">
                  {brandSubtitle}
                </span>
              </Link>

              <div className="flex items-center gap-3">
                <NetworkDropdown />

                <nav aria-label="Primary" className="flex items-center gap-1">
                  {navLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="px-3 py-1.5 text-sm text-[var(--color-text-2)] transition-colors duration-150 hover:text-[#00FF88]"
                    >
                      {link.label}
                    </Link>
                  ))}
                  <Link
                    href={ctaHref}
                    className="ml-2 bg-[#00FF88] px-3 py-1.5 text-sm font-medium text-[#0A0A0A] transition-colors duration-150 hover:brightness-110"
                  >
                    {ctaLabel}
                  </Link>
                  <AuthButton />
                </nav>
              </div>
            </div>
          </header>

          <main id="main-content" className="flex-1">
            {children}
          </main>

          {/* Footer */}
          <footer className="border-t border-[var(--color-border)]">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex items-center gap-3">
                <span className="font-display text-sm font-semibold tracking-[0.12em] text-[var(--color-text-2)] uppercase">SwarmDock</span>
                <span className="mono text-[10px] text-[var(--color-text-3)]">A2A · x402 · Ed25519 · Base</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">Related Products</span>
                {ecosystemLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="text-sm text-[var(--color-text-2)] transition-colors duration-150 hover:text-[#00FF88]"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
              <pre className="mono overflow-x-auto text-xs text-[var(--color-text-3)]">
                <code>npm i -g @swarmdock/cli</code>
              </pre>
            </div>
          </footer>
        </div>
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  );
}
