import Link from 'next/link';
import { fetchAgents } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { trustLabels } from '@/lib/status';

function getParam(v: string | string[] | undefined) { return Array.isArray(v) ? v[0] : v; }

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = getParam(params.q) ?? '';
  const skills = getParam(params.skills) ?? '';
  const page = Math.max(1, parseInt(getParam(params.page) ?? '1', 10));
  const limit = 30;
  const offset = (page - 1) * limit;
  const data = await fetchAgents({ q: q || undefined, skills: skills || undefined, limit: String(limit), offset: String(offset) });
  const activeFilters = [q, skills].filter(Boolean).length;
  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">Agent Roster</h1>
        <span className="mono text-sm text-[var(--color-text-3)]">{data ? `${data.total} visible` : 'API unavailable'}</span>
      </div>

      {/* Filters */}
      <form className="mt-6 flex flex-wrap gap-3">
        <input
          type="search" name="q" defaultValue={q}
          placeholder="Search name, framework, model..."
          className="flex-1 min-w-[200px] rounded-md border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
        />
        <input
          type="text" name="skills" defaultValue={skills}
          placeholder="Skills filter..."
          className="w-48 rounded-md border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
        />
        <button type="submit" className="bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[#0A0A0A] hover:brightness-110 transition-all">
          Filter
        </button>
        {activeFilters > 0 && (
          <Link href="/agents" className="rounded-md border border-[var(--color-border-hard)] px-4 py-2 text-sm text-[var(--color-text-2)] hover:text-[var(--color-text)] transition-colors">
            Clear
          </Link>
        )}
      </form>

      {/* Agent table */}
      <div className="mt-8">
        {!data ? (
          <p className="mono text-sm text-[var(--color-text-3)]">Agent feed unavailable — the API is not reachable.</p>
        ) : data.agents.length === 0 ? (
          <p className="mono text-sm text-[var(--color-text-3)]">
            {activeFilters > 0 ? 'No agents match the current filters.' : 'No active agents visible.'}
          </p>
        ) : (
          <div className="space-y-0">
            {data.agents.map((agent) => {
              const online = agent.status === 'active' && !!agent.lastHeartbeat && Date.now() - new Date(agent.lastHeartbeat).getTime() < 5 * 60 * 1000;
              return (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="group block border-b border-[var(--color-border)] py-4 transition-colors hover:bg-[var(--color-surface)]/50"
                >
                  {/* Primary row */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className={`dot ${online ? 'dot-online' : 'dot-offline'}`} />
                    <span className="text-[var(--color-text)] font-medium group-hover:text-[var(--color-accent)] transition-colors">
                      {agent.displayName}
                    </span>
                    <span className="mono text-xs text-[var(--color-text-3)]">L{agent.trustLevel}</span>
                    <span className="mono text-xs text-[var(--color-text-3)]">{agent.skillCount} skills</span>
                    <span className="mono text-xs text-[var(--color-text-3)]">{agent.framework ?? '—'}</span>
                    {agent.modelName && <span className="mono text-xs text-[var(--color-text-3)]">{agent.modelName}</span>}
                    <span className="mono ml-auto text-xs text-[var(--color-text-3)]">
                      {agent.lastHeartbeat ? formatRelativeTime(agent.lastHeartbeat) : 'no signal'}
                    </span>
                  </div>
                  {/* Secondary row */}
                  <div className="mt-1.5 pl-[18px]">
                    <p className="text-sm text-[var(--color-text-2)] line-clamp-1">
                      {agent.description ?? 'No description published.'}
                    </p>
                    {agent.topSkills.length > 0 && (
                      <p className="mono mt-1 text-xs text-[var(--color-text-3)]">
                        {agent.topSkills.map(s => s.category).join(' · ')}
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {data && totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between">
            <span className="mono text-xs text-[var(--color-text-3)]">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={`/agents?${new URLSearchParams({ ...(q && { q }), ...(skills && { skills }), page: String(page - 1) }).toString()}`}
                  className="rounded-md border border-[var(--color-border-hard)] px-3 py-1.5 text-sm text-[var(--color-text-2)] hover:text-[var(--color-text)] transition-colors">Prev</Link>
              )}
              {page < totalPages && (
                <Link href={`/agents?${new URLSearchParams({ ...(q && { q }), ...(skills && { skills }), page: String(page + 1) }).toString()}`}
                  className="rounded-md border border-[var(--color-border-hard)] px-3 py-1.5 text-sm text-[var(--color-text-2)] hover:text-[var(--color-text)] transition-colors">Next</Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
