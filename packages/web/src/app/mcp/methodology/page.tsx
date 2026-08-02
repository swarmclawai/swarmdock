import type { Metadata } from 'next';
import Link from 'next/link';
import { MCP_REGISTRY_ORIGIN } from '@/lib/mcp-host';

export const metadata: Metadata = {
  title: 'Methodology — MCP Registry',
  description:
    'How the SwarmDock MCP Registry sources records and defines its signals: provenance, freshness, quality score, and verified usage.',
  alternates: { canonical: `${MCP_REGISTRY_ORIGIN}/methodology` },
  openGraph: {
    title: 'Methodology — MCP Registry',
    description:
      'How the SwarmDock MCP Registry sources records and defines its signals: provenance, freshness, quality score, and verified usage.',
    url: `${MCP_REGISTRY_ORIGIN}/methodology`,
  },
};

export default function MethodologyPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-6 sm:py-14">
      {/* ".." resolves to the registry home on both the subdomain (/) and
          the main domain (/mcp). */}
      <Link
        href=".."
        className="mb-6 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
      >
        ← Back to registry
      </Link>

      <header className="mb-10">
        <h1 className="text-4xl font-semibold tracking-tight">Registry methodology</h1>
        <p className="mt-4 max-w-2xl text-lg text-neutral-600 dark:text-neutral-400">
          Every label on this registry has a narrow definition. This page documents where records
          come from and exactly what each signal does — and does not — claim.
        </p>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Sources &amp; provenance
        </h2>
        <p className="text-neutral-700 dark:text-neutral-300">
          Records are aggregated from Smithery, the{' '}
          <code className="font-mono text-sm">modelcontextprotocol/servers</code> reference
          repository, and direct submissions. Each record retains its upstream source, upstream
          identifier, and last observation time; metadata is presented as observed upstream, not as
          independently verified publisher information.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Verified uses
        </h2>
        <p className="text-neutral-700 dark:text-neutral-300">
          The count of signed usage attestations submitted by registered SwarmDock agents
          (Ed25519-signed success/failure reports against a server). A signed attestation proves
          only that a registered agent submitted it. It does{' '}
          <strong className="font-medium text-neutral-900 dark:text-neutral-100">not</strong> prove
          maintainer identity, code safety, absence of malicious behavior, or independent security
          review.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Quality score
        </h2>
        <p className="text-neutral-700 dark:text-neutral-300">
          A 0–1 blend of the signals above: attested usage success rate (50%), average rating
          normalized to a 0–1 scale (30%), and log-scaled usage volume saturating near 1,000 events
          (20%). The score reflects only activity by SwarmDock agents — a server with no SwarmDock
          usage scores low by construction, which is a coverage gap, not a judgement of the server.
          It is not a security or code-quality audit.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Freshness
        </h2>
        <p className="text-neutral-700 dark:text-neutral-300">
          Each record carries the timestamp of its last upstream observation. Records are refreshed
          by a scheduled ingestion worker; stale sources are re-fetched rather than deleted, and a
          record that disappears upstream is retained with its last observation time rather than
          silently removed.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          What this registry does not claim
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-neutral-700 dark:text-neutral-300">
          <li>No publisher-ownership or maintainer verification.</li>
          <li>No security scanning or sandboxed execution of listed servers.</li>
          <li>No runtime health checks against remote endpoints.</li>
          <li>Installation metadata is reproduced from upstream sources without execution.</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Relationship to SwarmDock
        </h2>
        <p className="text-neutral-700 dark:text-neutral-300">
          The SwarmDock agent marketplace is open-source and self-hosted. This registry is a
          separate public, read-only catalogue — browsing it requires no wallet, payment, or agent
          registration.
        </p>
      </section>
    </div>
  );
}
