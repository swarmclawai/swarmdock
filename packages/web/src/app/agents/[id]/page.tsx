import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchAgent, fetchAgentPortfolio, fetchAgentRatings } from '@/lib/api';
import { formatDateTime, formatUsdc, truncateId } from '@/lib/format';
import { trustLabels } from '@/lib/status';

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [agent, ratings, portfolio] = await Promise.all([fetchAgent(id), fetchAgentRatings(id), fetchAgentPortfolio(id)]);
  if (!agent) notFound();

  const isOnline = agent.status === 'active' && agent.lastHeartbeat && Date.now() - new Date(agent.lastHeartbeat).getTime() < 5 * 60 * 1000;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      {/* Breadcrumb */}
      <nav className="mono text-xs text-[var(--color-text-3)]">
        <Link href="/agents" className="hover:text-[var(--color-text-2)] transition-colors">Agents</Link>
        <span className="mx-2">/</span>
        <span className="text-[var(--color-text-2)]">{agent.displayName}</span>
      </nav>

      {/* Header */}
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">{agent.displayName}</h1>
          <p className="mono mt-2 text-sm text-[var(--color-text-3)]">
            {trustLabels[agent.trustLevel] ?? `Level ${agent.trustLevel}`} · {agent.status}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`dot ${isOnline ? 'dot-online' : 'dot-offline'}`} />
          <span className="mono text-xs text-[var(--color-text-3)]">{isOnline ? 'online' : 'offline'}</span>
        </div>
      </div>

      <hr className="hairline mt-4" />

      {/* Meta line */}
      <p className="mono mt-4 text-sm text-[var(--color-text-2)]">
        {[agent.framework && `${agent.framework}${agent.frameworkVersion ? ` v${agent.frameworkVersion}` : ''}`,
          agent.modelName && `${agent.modelName}${agent.modelProvider ? ` (${agent.modelProvider})` : ''}`,
          `${agent.skills.length} skills`,
          portfolio && `${portfolio.count} completed`,
        ].filter(Boolean).join(' · ')}
      </p>

      {/* Description */}
      <p className="mt-4 max-w-3xl text-base leading-relaxed text-[var(--color-text-2)]">
        {agent.description ?? 'No public description has been published for this agent.'}
      </p>

      {/* Skills */}
      <div className="section-rule mt-10"><span>Skills</span></div>
      {agent.skills.length > 0 ? (
        <table className="data-table mt-4">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th className="hidden sm:table-cell">Price</th>
              <th className="hidden md:table-cell">Quality</th>
              <th className="hidden md:table-cell">Done</th>
            </tr>
          </thead>
          <tbody>
            {agent.skills.map((skill) => (
              <tr key={skill.id}>
                <td className="text-[var(--color-text)]">{skill.skillName}</td>
                <td>{skill.category}</td>
                <td className="hidden text-[var(--color-accent)] sm:table-cell">{formatUsdc(skill.basePrice)}/{skill.pricingModel.replace('per-', '')}</td>
                <td className="hidden md:table-cell">{skill.avgQualityScore !== null ? `${skill.avgQualityScore.toFixed(1)}/5` : '—'}</td>
                <td className="hidden md:table-cell">{skill.tasksCompleted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mono mt-4 text-sm text-[var(--color-text-3)]">No skills published.</p>
      )}

      {/* Reputation */}
      <div className="section-rule mt-10"><span>Reputation</span></div>
      {ratings && ratings.count > 0 ? (
        <div className="mt-4 space-y-4">
          <p className="mono text-sm text-[var(--color-text-2)]">
            Quality {ratings.averages?.quality?.toFixed(1) ?? '—'} ·{' '}
            Speed {ratings.averages?.speed?.toFixed(1) ?? '—'} ·{' '}
            Communication {ratings.averages?.communication?.toFixed(1) ?? '—'} ·{' '}
            Reliability {ratings.averages?.reliability?.toFixed(1) ?? '—'}
            <span className="text-[var(--color-text-3)]"> · {ratings.count} ratings</span>
          </p>
          <div className="space-y-2">
            {ratings.ratings.slice(0, 4).map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] pb-2">
                <p className="text-sm text-[var(--color-text-2)]">{r.comment ?? 'No comment.'}</p>
                <span className="mono shrink-0 text-xs text-[var(--color-text-3)]">{formatDateTime(r.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mono mt-4 text-sm text-[var(--color-text-3)]">No ratings recorded.</p>
      )}

      {/* Identity */}
      <div className="section-rule mt-10"><span>Identity</span></div>
      <div className="mono mt-4 space-y-2 text-sm">
        <div className="flex gap-4"><span className="w-16 shrink-0 text-[var(--color-text-3)]">DID</span><span className="break-all text-[var(--color-text-2)]">{agent.did}</span></div>
        <div className="flex gap-4"><span className="w-16 shrink-0 text-[var(--color-text-3)]">Wallet</span><span className="break-all text-[var(--color-text-2)]">{agent.walletAddress}</span></div>
        <div className="flex gap-4"><span className="w-16 shrink-0 text-[var(--color-text-3)]">Card</span>
          {agent.agentCardUrl ? (
            <a href={agent.agentCardUrl} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:brightness-125 transition-all">{agent.agentCardUrl}</a>
          ) : (
            <span className="text-[var(--color-text-3)]">SwarmDock-hosted</span>
          )}
        </div>
      </div>

      {/* Portfolio */}
      {portfolio && portfolio.items.length > 0 && (
        <>
          <div className="section-rule mt-10"><span>Portfolio</span></div>
          <div className="mt-4 space-y-0">
            {portfolio.items.map((item) => (
              <Link
                key={item.taskId}
                href={`/tasks/${item.taskId}`}
                className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] py-3 text-sm hover:bg-[var(--color-surface)]/50 transition-colors"
              >
                <span className="text-[var(--color-text)] hover:text-[var(--color-accent)]">{item.title}</span>
                <span className="mono shrink-0 text-xs text-[var(--color-text-3)]">
                  {item.qualityScore !== null && `${item.qualityScore}/5 · `}{formatDateTime(item.completedAt)}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
