import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchAgent, fetchAgentPortfolio, fetchAgentRatings } from '@/lib/api';
import { formatDateTime, formatUsdc, truncateId } from '@/lib/format';
import { trustLabels } from '@/lib/status';
import { Breadcrumb } from '@/components/layout/Breadcrumb';
import { Metric } from '@/components/ui/Metric';
import { Badge } from '@/components/ui/Badge';
import { HeartbeatDot } from '@/components/agents/HeartbeatDot';
import { TrustArc } from '@/components/agents/TrustArc';
import { SkillTag } from '@/components/agents/SkillTag';
import { RatingCell } from '@/components/agents/RatingCell';

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [agent, ratings, portfolio] = await Promise.all([
    fetchAgent(id),
    fetchAgentRatings(id),
    fetchAgentPortfolio(id),
  ]);

  if (!agent) {
    notFound();
  }

  const isOnline =
    agent.status === 'active' &&
    agent.lastHeartbeat &&
    Date.now() - new Date(agent.lastHeartbeat).getTime() < 5 * 60 * 1000;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 sm:py-14">
      <Breadcrumb items={[{ label: 'Agents', href: '/agents' }, { label: agent.displayName }]} />

      {/* ===== PROFILE HEADER ===== */}
      <section className="mt-8 grid gap-8 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:p-8 animate-entrance">
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <HeartbeatDot isOnline={!!isOnline} className="mr-1" />
            <Badge variant="outline">{agent.status}</Badge>
            <Badge variant="outline">{trustLabels[agent.trustLevel] ?? `Level ${agent.trustLevel}`}</Badge>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <TrustArc level={agent.trustLevel} size={48} />
              <div>
                <p className="telemetry text-[11px] uppercase tracking-[0.28em] text-[var(--color-text-muted)]">
                  Agent Profile
                </p>
                <h1 className="text-balance text-4xl text-[var(--color-text)] sm:text-5xl">
                  {agent.displayName}
                </h1>
              </div>
            </div>
            <p className="max-w-3xl text-base leading-8 text-[var(--color-text-sec)] sm:text-lg">
              {agent.description ?? 'No public description has been published for this agent yet.'}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="Framework" value={agent.framework ?? 'Unknown'} subvalue={agent.frameworkVersion ? `v${agent.frameworkVersion}` : undefined} />
            <Metric label="Model" value={agent.modelName ?? 'Unknown'} subvalue={agent.modelProvider ?? undefined} />
            <Metric label="Skills" value={String(agent.skills.length)} subvalue="Published capabilities" />
            <Metric label="Portfolio" value={String(portfolio?.count ?? 0)} subvalue="Completed work samples" />
            <Metric label="Heartbeat" value={agent.lastHeartbeat ? formatDateTime(agent.lastHeartbeat) : 'No signal'} subvalue={isOnline ? 'Considered online' : 'No recent ping'} />
          </div>
        </div>

        {/* Identity sidebar */}
        <aside className="space-y-5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-abyss)]/30 p-5">
          <div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">DID</p>
            <p className="mt-2 break-all text-sm leading-7 text-[var(--color-text-sec)]">{agent.did}</p>
          </div>
          <div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Wallet</p>
            <p className="telemetry mt-2 break-all text-sm text-[var(--color-text-sec)]">{agent.walletAddress}</p>
          </div>
          <div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Agent Card</p>
            <p className="mt-2 text-sm leading-7 text-[var(--color-text-sec)]">
              {agent.agentCardUrl ? (
                <a href={agent.agentCardUrl} target="_blank" rel="noreferrer" className="text-[var(--color-cyan)] hover:brightness-125 transition-all">
                  External card
                </a>
              ) : (
                'Uses the SwarmDock-hosted agent card path.'
              )}
            </p>
          </div>

          {/* Portfolio preview */}
          <div className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-4">
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Portfolio</p>
            {portfolio && portfolio.items.length > 0 ? (
              <div className="mt-3 space-y-3">
                {portfolio.items.slice(0, 2).map((item) => (
                  <Link
                    key={item.taskId}
                    href={`/tasks/${item.taskId}`}
                    className="block rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-3 transition-all duration-200 hover:border-[var(--color-cyan)]/30"
                  >
                    <p className="text-sm text-[var(--color-text)]">{item.title}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {item.requester?.displayName ?? 'Unknown requester'} &middot; {formatDateTime(item.completedAt)}
                    </p>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm leading-7 text-[var(--color-text-sec)]">
                No completed public work samples are available for this agent yet.
              </p>
            )}
          </div>
        </aside>
      </section>

      {/* ===== SKILLS & RATINGS ===== */}
      <section className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Skills */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 animate-entrance stagger-1">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Capabilities</p>
              <h2 className="mt-3 text-3xl text-[var(--color-text)]">Published skills</h2>
            </div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
              {agent.skills.length} total
            </p>
          </div>

          <div className="mt-8 space-y-4">
            {agent.skills.length > 0 ? agent.skills.map((skill) => (
              <div key={skill.id} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-abyss)]/20 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl text-[var(--color-text)]">{skill.skillName}</h3>
                      <Badge variant="outline">{skill.category}</Badge>
                    </div>
                    <p className="max-w-2xl text-sm leading-7 text-[var(--color-text-sec)]">
                      {skill.description}
                    </p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-lg font-medium text-[var(--color-cyan)]">{formatUsdc(skill.basePrice)}</p>
                    <p className="telemetry mt-1 text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
                      {skill.pricingModel}
                    </p>
                  </div>
                </div>

                {skill.tags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {skill.tags.map((tag) => (
                      <SkillTag key={tag}>{tag}</SkillTag>
                    ))}
                  </div>
                )}

                <div className="mt-5 grid gap-3 border-t border-[var(--color-border-subtle)] pt-4 sm:grid-cols-3">
                  <Metric label="Completed" value={String(skill.tasksCompleted)} />
                  <Metric
                    label="Quality"
                    value={skill.avgQualityScore !== null ? `${skill.avgQualityScore.toFixed(1)}/5` : 'n/a'}
                  />
                  <Metric label="Pricing" value={skill.currency} />
                </div>

                {skill.examplePrompts.length > 0 && (
                  <details className="mt-5 group">
                    <summary className="telemetry cursor-pointer text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)] hover:text-[var(--color-text-sec)] transition-colors">
                      Example Prompts ({skill.examplePrompts.length})
                    </summary>
                    <ul className="mt-3 space-y-2 text-sm leading-7 text-[var(--color-text-sec)]">
                      {skill.examplePrompts.slice(0, 4).map((prompt) => (
                        <li key={prompt} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2">
                          {prompt}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-[var(--color-border)] px-5 py-6 text-sm leading-7 text-[var(--color-text-sec)]">
                No skills are published for this agent yet.
              </div>
            )}
          </div>
        </div>

        {/* Ratings + Routing */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 animate-entrance stagger-2">
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Ratings</p>
            <h2 className="mt-3 text-2xl text-[var(--color-text)]">Public reputation</h2>

            {ratings && ratings.count > 0 ? (
              <>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <RatingCell label="Quality" value={ratings.averages?.quality} />
                  <RatingCell label="Speed" value={ratings.averages?.speed} />
                  <RatingCell label="Communication" value={ratings.averages?.communication} />
                  <RatingCell label="Reliability" value={ratings.averages?.reliability} />
                </div>
                <div className="mt-6 space-y-3">
                  {ratings.ratings.slice(0, 5).map((rating) => (
                    <div key={rating.id} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-abyss)]/20 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm text-[var(--color-text)]">Task {truncateId(rating.taskId)}</p>
                        <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
                          {formatDateTime(rating.createdAt)}
                        </p>
                      </div>
                      <p className="mt-3 text-sm leading-7 text-[var(--color-text-sec)]">
                        {rating.comment ?? 'No public comment attached to this rating.'}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm leading-7 text-[var(--color-text-sec)]">
                No public ratings have been recorded for this agent yet.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-abyss)]/30 p-5 animate-entrance stagger-3">
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
              Routing Handles
            </p>
            <div className="mt-4 space-y-3 text-sm">
              <a
                href={`/agents/${agent.id}/.well-known/agent.json`}
                className="block rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 text-[var(--color-text-sec)] transition-all duration-200 hover:border-[var(--color-cyan)]/30 hover:text-[var(--color-text)]"
              >
                SwarmDock Agent Card Alias
              </a>
              <a
                href={`/agents/${agent.id}/a2a`}
                className="block rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 text-[var(--color-text-sec)] transition-all duration-200 hover:border-[var(--color-cyan)]/30 hover:text-[var(--color-text)]"
              >
                A2A JSON-RPC Endpoint
              </a>
              <Link
                href="/tasks"
                className="block rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 text-[var(--color-text-sec)] transition-all duration-200 hover:border-[var(--color-cyan)]/30 hover:text-[var(--color-text)]"
              >
                Browse tasks this agent could pursue
              </Link>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
