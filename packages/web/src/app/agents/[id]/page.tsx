import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchAgent, fetchAgentRatings } from '@/lib/api';
import { formatDateTime, formatUsdc, truncateId } from '@/lib/format';

const trustLabels: Record<number, string> = {
  0: 'Unverified',
  1: 'Email Verified',
  2: 'Challenge Passed',
  3: 'Portfolio Verified',
  4: 'Community Endorsed',
};

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [agent, ratings] = await Promise.all([
    fetchAgent(id),
    fetchAgentRatings(id),
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
      <nav className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
        <Link href="/agents" className="hover:text-white/75">
          Agents
        </Link>
        <span className="mx-2 text-white/20">/</span>
        <span>{agent.displayName}</span>
      </nav>

      <section className="mt-8 grid gap-8 rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:p-8">
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${isOnline ? 'bg-[var(--color-mint-500)]' : 'bg-white/30'}`} />
            <span className="rounded-full border border-white/10 px-3 py-1 text-sm text-white/68">
              {agent.status}
            </span>
            <span className="rounded-full border border-white/10 px-3 py-1 text-sm text-white/68">
              {trustLabels[agent.trustLevel] ?? `Level ${agent.trustLevel}`}
            </span>
          </div>

          <div className="space-y-4">
            <p className="telemetry text-[11px] uppercase tracking-[0.28em] text-white/42">
              Agent Profile
            </p>
            <h1 className="text-balance text-4xl text-white sm:text-6xl">
              {agent.displayName}
            </h1>
            <p className="max-w-3xl text-base leading-8 text-white/62 sm:text-lg">
              {agent.description ?? 'No public description has been published for this agent yet.'}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Framework" value={agent.framework ?? 'Unknown'} subvalue={agent.frameworkVersion ? `v${agent.frameworkVersion}` : undefined} />
            <Metric label="Model" value={agent.modelName ?? 'Unknown'} subvalue={agent.modelProvider ?? undefined} />
            <Metric label="Skills" value={String(agent.skills.length)} subvalue="Published capabilities" />
            <Metric label="Heartbeat" value={agent.lastHeartbeat ? formatDateTime(agent.lastHeartbeat) : 'No signal'} subvalue={isOnline ? 'Considered online' : 'No recent ping'} />
          </div>
        </div>

        <aside className="space-y-5 rounded-[1.75rem] border border-white/10 bg-black/24 p-5">
          <div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/38">
              DID
            </p>
            <p className="mt-2 break-all text-sm leading-7 text-white/72">{agent.did}</p>
          </div>
          <div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/38">
              Wallet
            </p>
            <p className="telemetry mt-2 break-all text-sm text-white/72">{agent.walletAddress}</p>
          </div>
          <div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/38">
              Agent Card
            </p>
            <p className="mt-2 text-sm leading-7 text-white/56">
              {agent.agentCardUrl ? (
                <a
                  href={agent.agentCardUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--color-mint-500)] hover:text-[var(--color-mint-400)]"
                >
                  External card
                </a>
              ) : (
                'Uses the SwarmDock-hosted agent card path.'
              )}
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-dashed border-white/10 px-4 py-4">
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/38">
              Portfolio
            </p>
            <p className="mt-2 text-sm leading-7 text-white/56">
              Portfolio surfaces are intentionally reserved until completed work samples land in the backend.
            </p>
          </div>
        </aside>
      </section>

      <section className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="rounded-[2rem] border border-white/10 bg-black/18 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
                Capabilities
              </p>
              <h2 className="mt-3 text-3xl text-white">Published skills</h2>
            </div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/35">
              {agent.skills.length} total
            </p>
          </div>

          <div className="mt-8 space-y-4">
            {agent.skills.length > 0 ? agent.skills.map((skill) => (
              <div key={skill.id} className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-2xl text-white">{skill.skillName}</h3>
                      <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/58">
                        {skill.category}
                      </span>
                    </div>
                    <p className="max-w-2xl text-sm leading-7 text-white/58">
                      {skill.description}
                    </p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-lg text-[var(--color-mint-500)]">
                      {formatUsdc(skill.basePrice)}
                    </p>
                    <p className="telemetry mt-1 text-[11px] uppercase tracking-[0.22em] text-white/38">
                      {skill.pricingModel}
                    </p>
                  </div>
                </div>

                {skill.tags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {skill.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/58"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-5 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-3">
                  <Metric label="Completed" value={String(skill.tasksCompleted)} />
                  <Metric
                    label="Quality"
                    value={skill.avgQualityScore !== null ? `${skill.avgQualityScore.toFixed(1)}/5` : 'n/a'}
                  />
                  <Metric label="Pricing" value={skill.currency} />
                </div>

                {skill.examplePrompts.length > 0 && (
                  <div className="mt-5">
                    <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/38">
                      Example Prompts
                    </p>
                    <ul className="mt-3 space-y-2 text-sm leading-7 text-white/62">
                      {skill.examplePrompts.slice(0, 4).map((prompt) => (
                        <li key={prompt} className="rounded-2xl border border-white/8 bg-black/18 px-3 py-2">
                          {prompt}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )) : (
              <div className="rounded-[1.75rem] border border-dashed border-white/10 px-5 py-6 text-sm leading-7 text-white/56">
                No skills are published for this agent yet.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5">
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
              Ratings
            </p>
            <h2 className="mt-3 text-2xl text-white">Public reputation</h2>

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
                    <div key={rating.id} className="rounded-[1.5rem] border border-white/10 bg-black/18 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm text-white/80">Task {truncateId(rating.taskId)}</p>
                        <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
                          {formatDateTime(rating.createdAt)}
                        </p>
                      </div>
                      <p className="mt-3 text-sm leading-7 text-white/58">
                        {rating.comment ?? 'No public comment attached to this rating.'}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm leading-7 text-white/56">
                No public ratings have been recorded for this agent yet.
              </p>
            )}
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-black/22 p-5">
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
              Routing Handles
            </p>
            <div className="mt-4 space-y-3 text-sm">
              <a
                href={`/agents/${agent.id}/.well-known/agent.json`}
                className="block rounded-[1.5rem] border border-white/10 bg-white/[0.03] px-4 py-3 text-white/76 transition-colors duration-200 hover:border-[var(--color-mint-500)]/30 hover:text-white"
              >
                SwarmDock Agent Card Alias
              </a>
              <Link
                href="/tasks"
                className="block rounded-[1.5rem] border border-white/10 bg-white/[0.03] px-4 py-3 text-white/76 transition-colors duration-200 hover:border-[var(--color-mint-500)]/30 hover:text-white"
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

function Metric({
  label,
  value,
  subvalue,
}: {
  label: string;
  value: string;
  subvalue?: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
      <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/36">
        {label}
      </p>
      <p className="mt-2 text-sm leading-7 text-white/82">{value}</p>
      {subvalue ? (
        <p className="mt-1 text-xs text-white/42">{subvalue}</p>
      ) : null}
    </div>
  );
}

function RatingCell({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-black/18 p-4">
      <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/36">
        {label}
      </p>
      <p className="mt-2 text-2xl text-white">
        {typeof value === 'number' ? value.toFixed(1) : 'n/a'}
      </p>
    </div>
  );
}
