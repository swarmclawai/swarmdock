import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchMcpServer } from '@/lib/api';

export const revalidate = 60;

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const server = await fetchMcpServer(slug);
  if (!server) return { title: 'MCP Server not found — SwarmDock' };
  return {
    title: `${server.name} — SwarmDock MCP Registry`,
    description: server.description.slice(0, 200),
  };
}

function formatUsdc(micro: string | null): string {
  if (!micro) return 'Free';
  try {
    const value = Number(BigInt(micro)) / 1_000_000;
    return `$${value.toFixed(4)} USDC`;
  } catch {
    return 'Free';
  }
}

export default async function McpServerDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const server = await fetchMcpServer(slug);
  if (!server) notFound();

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-6 sm:py-14">
      <Link
        href="/mcp"
        className="mb-6 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
      >
        ← Back to registry
      </Link>

      <header className="mb-10">
        <div className="mb-3 flex items-center gap-2">
          <h1 className="text-4xl font-semibold tracking-tight">{server.name}</h1>
          {server.paidTier ? (
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600">
              Paid — {formatUsdc(server.priceMicroUsdc)}
            </span>
          ) : (
            <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-500 dark:bg-neutral-800">
              Free
            </span>
          )}
        </div>
        <p className="font-mono text-xs text-neutral-500">{server.slug}</p>
        <p className="mt-4 text-lg text-neutral-700 dark:text-neutral-300">
          {server.description}
        </p>
      </header>

      <section className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Quality score" value={server.qualityScore.toFixed(3)} />
        <Stat label="Verified uses" value={server.verifiedUsageCount.toLocaleString()} />
        <Stat
          label="Avg rating"
          value={server.avgRating !== null ? `${server.avgRating.toFixed(2)} / 5` : '—'}
        />
        <Stat label="Ratings" value={server.ratingCount.toLocaleString()} />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Metadata
        </h2>
        <dl className="grid grid-cols-1 gap-3 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900 sm:grid-cols-2">
          <MetadataRow label="Transport" value={<span className="font-mono">{server.transport}</span>} />
          <MetadataRow label="Auth" value={<span className="font-mono">{server.authMode}</span>} />
          {server.language ? <MetadataRow label="Language" value={server.language} /> : null}
          {server.license ? <MetadataRow label="License" value={server.license} /> : null}
          {server.repoUrl ? (
            <MetadataRow
              label="Repo"
              value={
                <a
                  href={server.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-orange-500 hover:underline"
                >
                  {server.repoUrl}
                </a>
              }
            />
          ) : null}
          {server.homepage ? (
            <MetadataRow
              label="Homepage"
              value={
                <a
                  href={server.homepage}
                  target="_blank"
                  rel="noreferrer"
                  className="text-orange-500 hover:underline"
                >
                  {server.homepage}
                </a>
              }
            />
          ) : null}
        </dl>
      </section>

      {server.installations.length > 0 ? (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
            Installation
          </h2>
          <div className="space-y-3">
            {server.installations.map((install) => (
              <div
                key={install.id}
                className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="mb-2 font-mono text-xs uppercase tracking-wider text-neutral-500">
                  {install.method}
                </div>
                <pre className="overflow-x-auto text-xs text-neutral-700 dark:text-neutral-300">
                  {JSON.stringify(install.spec, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {server.tools.length > 0 ? (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
            Tools ({server.tools.length})
          </h2>
          <div className="space-y-2">
            {server.tools.map((tool) => (
              <div
                key={tool.id}
                className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="font-mono text-sm font-medium">{tool.name}</div>
                {tool.description ? (
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                    {tool.description}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {server.tags.length > 0 ? (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
            Tags
          </h2>
          <div className="flex flex-wrap gap-2">
            {server.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
              >
                {tag}
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-xs uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-neutral-500">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}
