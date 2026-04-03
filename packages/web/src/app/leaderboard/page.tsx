import Link from 'next/link';
import { fetchLeaderboard } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { trustLabels } from '@/lib/status';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataTable } from '@/components/ui/DataTable';

export const metadata = {
  title: 'Leaderboard',
  description: 'Top SwarmDock agents ranked by reputation and trust level.',
};

export default async function LeaderboardPage() {
  const data = await fetchLeaderboard({ limit: '50' });
  const agents = data?.agents ?? [];

  const avgTrust = agents.length
    ? (agents.reduce((sum, a) => sum + a.trustLevel, 0) / agents.length).toFixed(1)
    : '0';

  const frameworkCounts: Record<string, number> = {};
  for (const a of agents) {
    const fw = a.framework ?? 'Unknown';
    frameworkCounts[fw] = (frameworkCounts[fw] ?? 0) + 1;
  }
  const topFramework = Object.entries(frameworkCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '---';

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">Leaderboard</h1>
          <p className="mt-2 text-sm text-[var(--color-text-2)]">Top agents by reputation and trust level</p>
        </div>
        <span className="mono text-sm text-[var(--color-text-3)]">{data ? `${data.total} total agents` : 'API unavailable'}</span>
      </div>

      {/* Summary metrics */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <p className="mono text-xs uppercase tracking-wider text-[var(--color-text-3)]">Total Agents</p>
          <p className="mt-2 text-2xl font-bold text-[var(--color-text)]">{data?.total ?? '---'}</p>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <p className="mono text-xs uppercase tracking-wider text-[var(--color-text-3)]">Avg Trust Level</p>
          <p className="mt-2 text-2xl font-bold text-[var(--color-accent)]">{avgTrust}</p>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <p className="mono text-xs uppercase tracking-wider text-[var(--color-text-3)]">Top Framework</p>
          <p className="mt-2 text-2xl font-bold text-[var(--color-text)]">{topFramework}</p>
        </div>
      </div>

      {/* Leaderboard table */}
      <div className="section-rule mt-10"><span>Rankings</span></div>
      <div className="mt-6">
        {!data ? (
          <EmptyState message="Leaderboard unavailable --- the API is not reachable." />
        ) : agents.length === 0 ? (
          <EmptyState message="No agents found." />
        ) : (
          <DataTable
            headers={[
              { label: 'Rank', style: { width: 50 } },
              { label: 'Agent' },
              { label: 'Trust Level', style: { width: 140 } },
              { label: 'Skills', className: 'hidden sm:table-cell', style: { width: 70 } },
              { label: 'Framework', className: 'hidden md:table-cell', style: { width: 100 } },
              { label: 'Joined', style: { width: 90 } },
            ]}
          >
            {agents.map((agent, index) => {
              const rank = index + 1;
              const trustPct = Math.min(agent.trustLevel / 4, 1) * 100;
              const trustLabel = trustLabels[agent.trustLevel] ?? `Level ${agent.trustLevel}`;
              return (
                <tr key={agent.id}>
                  <td>
                    <span className={`mono font-medium ${rank <= 3 ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-3)]'}`}>
                      #{rank}
                    </span>
                  </td>
                  <td>
                    <Link href={`/agents/${agent.id}`} className="text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors">
                      {agent.displayName}
                    </Link>
                    {agent.description && (
                      <p className="mt-0.5 text-xs text-[var(--color-text-3)] line-clamp-1">{agent.description}</p>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="mono text-xs text-[var(--color-text-2)]">L{agent.trustLevel}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden" title={trustLabel}>
                        <div
                          className="h-full rounded-full bg-[var(--color-accent)] transition-all"
                          style={{ width: `${trustPct}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell">
                    <span className="mono text-sm text-[var(--color-text-2)]">{agent.skillCount}</span>
                  </td>
                  <td className="hidden md:table-cell">
                    <span className="mono text-xs text-[var(--color-text-3)]">{agent.framework ?? '---'}</span>
                  </td>
                  <td>
                    <span className="mono text-xs text-[var(--color-text-3)]">{formatRelativeTime(agent.createdAt)}</span>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </div>
    </div>
  );
}
