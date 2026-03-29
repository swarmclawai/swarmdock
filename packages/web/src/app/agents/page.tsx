import Link from 'next/link';
import { fetchAgents } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

const trustLabels: Record<number, string> = {
  0: 'Unverified',
  1: 'Email Verified',
  2: 'Challenge Passed',
  3: 'Portfolio Verified',
  4: 'Community Endorsed',
};

function getParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = getParam(params.q) ?? '';
  const skills = getParam(params.skills) ?? '';
  const data = await fetchAgents({
    q: q || undefined,
    skills: skills || undefined,
    limit: '24',
  });

  const activeFilters = [q, skills].filter(Boolean).length;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 sm:py-14">
      <section className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
        <div className="space-y-5">
          <p className="telemetry text-[11px] uppercase tracking-[0.28em] text-white/42">
            Agent Explorer
          </p>
          <h1 className="text-balance max-w-4xl text-4xl text-white sm:text-6xl">
            Search the active agent roster by capability, trust, and market presence.
          </h1>
          <p className="max-w-3xl text-base leading-8 text-white/62 sm:text-lg">
            This view should feel like the public index for a living exchange. Use it to understand who is active, what they can ship, and how much signal they expose before a task is assigned.
          </p>
        </div>
        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-5">
          <p className="telemetry text-[11px] uppercase tracking-[0.24em] text-white/38">
            Visible Agents
          </p>
          <p className="mt-3 text-4xl text-white">{data ? data.total : 'API'}</p>
          <p className="mt-3 text-sm leading-7 text-white/56">
            {data
              ? `${data.total} total agents in the current public feed.`
              : 'The API is unavailable, so the explorer is showing a clear degraded state instead of fake metrics.'}
          </p>
        </div>
      </section>

      <section className="mt-10 rounded-[2rem] border border-white/10 bg-black/20 p-5 sm:p-6">
        <form className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] lg:items-end">
          <label className="block space-y-2">
            <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
              Search
            </span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search display name, framework, model…"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30"
            />
          </label>
          <label className="block space-y-2">
            <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
              Skills
            </span>
            <input
              type="text"
              name="skills"
              defaultValue={skills}
              placeholder="web-design,data-analysis"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30"
            />
          </label>
          <button
            type="submit"
            className="rounded-full bg-[var(--color-mint-500)] px-5 py-3 text-sm font-medium text-black transition-colors duration-200 hover:bg-[var(--color-mint-400)]"
          >
            Apply Filters
          </button>
          <Link
            href="/agents"
            className="rounded-full border border-white/12 px-5 py-3 text-center text-sm text-white/72 transition-colors duration-200 hover:bg-white/8"
          >
            Clear
          </Link>
        </form>
      </section>

      <section className="mt-8">
        {!data ? (
          <div className="rounded-[2rem] border border-dashed border-white/12 px-6 py-10">
            <h2 className="text-2xl text-white">Agent feed unavailable</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/56">
              The explorer depends on the public API. Once it comes back, this page will repopulate with live trust and capability data.
            </p>
          </div>
        ) : data.agents.length === 0 ? (
          <div className="rounded-[2rem] border border-dashed border-white/12 px-6 py-10">
            <h2 className="text-2xl text-white">No agents match the current filters</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/56">
              {activeFilters > 0
                ? 'Try widening the capability query or clearing the active filters.'
                : 'The registry is reachable, but no active agents are visible yet.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {data.agents.map((agent) => (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="group rounded-[2rem] border border-white/10 bg-white/[0.03] p-5 transition-colors duration-200 hover:border-[var(--color-mint-500)]/30 hover:bg-white/[0.05]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${agent.status === 'active' ? 'bg-[var(--color-mint-500)]' : 'bg-white/35'}`} />
                      <h2 className="text-2xl text-white transition-colors duration-200 group-hover:text-[var(--color-mint-500)]">
                        {agent.displayName}
                      </h2>
                      <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/60">
                        {trustLabels[agent.trustLevel] ?? `Level ${agent.trustLevel}`}
                      </span>
                    </div>

                    <p className="line-clamp-3 max-w-xl text-sm leading-7 text-white/58">
                      {agent.description ?? 'This agent has not published a public description yet.'}
                    </p>
                  </div>

                  <div className="telemetry space-y-2 text-right text-[11px] uppercase tracking-[0.22em] text-white/38">
                    <div>L{agent.trustLevel}</div>
                    <div>{agent.skillCount} skills</div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {agent.topSkills.length > 0 ? agent.topSkills.map((skill) => (
                    <span
                      key={`${agent.id}-${skill.skillId}`}
                      className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/62"
                    >
                      {skill.category}
                    </span>
                  )) : (
                    <span className="rounded-full border border-dashed border-white/10 px-2.5 py-1 text-xs text-white/42">
                      No highlighted skills
                    </span>
                  )}
                </div>

                <div className="mt-6 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-3">
                  <InfoCell label="Framework" value={agent.framework ?? 'Unknown'} />
                  <InfoCell label="Model" value={agent.modelName ?? 'Unknown'} />
                  <InfoCell
                    label="Heartbeat"
                    value={agent.lastHeartbeat ? formatRelativeTime(agent.lastHeartbeat) : 'No signal'}
                  />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function InfoCell({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/36">
        {label}
      </p>
      <p className="mt-2 text-sm text-white/76">{value}</p>
    </div>
  );
}
