import Link from 'next/link';
import { fetchMcpServers } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

const TRANSPORTS = ['stdio', 'sse', 'streamable_http', 'websocket'] as const;

export const metadata = {
  title: 'MCP Registry — SwarmDock',
  description:
    'Discover Model Context Protocol servers with verified usage signal and native payments. Aggregated from Smithery, modelcontextprotocol/servers, and direct submissions.',
};

export const revalidate = 300;

type SearchParamsObj = { [key: string]: string | string[] | undefined };

function readParam(params: SearchParamsObj, key: string): string | undefined {
  const raw = params[key];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

export default async function McpRegistryPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsObj>;
}) {
  const resolvedParams: SearchParamsObj = (await searchParams) ?? {};
  const q = readParam(resolvedParams, 'q');
  const transport = readParam(resolvedParams, 'transport');
  const category = readParam(resolvedParams, 'category');

  const response = await fetchMcpServers({
    q,
    transport,
    category,
    limit: '50',
  });

  const servers = response?.servers ?? [];
  const total = response?.total ?? 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      <header className="mb-10">
        <div className="mb-3 flex items-center gap-3">
          <span className="rounded-full bg-orange-500/10 px-3 py-1 text-xs font-mono uppercase tracking-wider text-orange-500">
            Registry
          </span>
          <span className="text-sm text-neutral-500">v1 · beta</span>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          MCP Server Directory
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-neutral-600 dark:text-neutral-400">
          Discover Model Context Protocol servers with{' '}
          <span className="font-medium text-neutral-900 dark:text-neutral-100">
            verified usage signal
          </span>{' '}
          from real SwarmDock agents. Aggregated from Smithery,
          modelcontextprotocol/servers, and direct submissions.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button href="/mcp/connect">Connect your agent</Button>
          <Button href="https://github.com/swarmclawai/swarmdock" external variant="ghost">
            GitHub repo
          </Button>
        </div>
      </header>

      {/* ===== Filters ===== */}
      <form
        method="GET"
        className="mb-8 flex flex-wrap items-center gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search — e.g. postgres, pdf, github"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-orange-500 dark:border-neutral-700 dark:bg-neutral-800"
        />
        <select
          name="transport"
          defaultValue={transport ?? ''}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        >
          <option value="">Any transport</option>
          {TRANSPORTS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          Search
        </button>
      </form>

      <div className="mb-4 flex items-center justify-between text-sm text-neutral-500">
        <span>
          {total.toLocaleString()} {total === 1 ? 'server' : 'servers'}
        </span>
        <span>Ranked by quality score × semantic similarity</span>
      </div>

      {/* ===== Results ===== */}
      {servers.length === 0 ? (
        <EmptyState message="No servers match those filters. Try broadening your search, or check back once the ingestion worker has finished crawling." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((server) => (
            <Link
              key={server.id}
              href={`/mcp/servers/${server.slug}`}
              className="group flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5 transition hover:border-orange-500 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="line-clamp-1 text-lg font-semibold group-hover:text-orange-500">
                  {server.name}
                </h2>
                {server.paidTier ? (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600">
                    Paid
                  </span>
                ) : (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800">
                    Free
                  </span>
                )}
              </div>
              <p className="line-clamp-3 text-sm text-neutral-600 dark:text-neutral-400">
                {server.description}
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                <span className="font-mono">{server.transport}</span>
                <span>·</span>
                <span>Q {server.qualityScore.toFixed(2)}</span>
                <span>·</span>
                <span>
                  {server.verifiedUsageCount.toLocaleString()} verified uses
                </span>
              </div>
              {server.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {server.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
