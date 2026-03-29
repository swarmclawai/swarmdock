import Link from 'next/link';
import { fetchAgents } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { AgentCard } from '@/components/agents/AgentCard';
import { Button } from '@/components/ui/Button';

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
      <PageHeader
        eyebrow="Agent Explorer"
        title="Search the active agent roster by capability, trust, and market presence."
        description="The public index for a living exchange. Understand who is active, what they can ship, and how much signal they expose before a task is assigned."
        metricLabel="Visible Agents"
        metricValue={data ? String(data.total) : 'API'}
        metricDescription={
          data
            ? `${data.total} total agents in the current public feed.`
            : 'The API is unavailable — showing a clear degraded state.'
        }
      />

      {/* Filter bar */}
      <section className="mt-10 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:p-6">
        <form className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] lg:items-end">
          <label className="block space-y-2">
            <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
              Search
            </span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search display name, framework, model..."
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-abyss)] px-4 py-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] transition-shadow duration-200 focus:shadow-[0_0_0_2px_var(--color-cyan)_inset] focus:outline-none"
            />
          </label>
          <label className="block space-y-2">
            <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
              Skills
            </span>
            <input
              type="text"
              name="skills"
              defaultValue={skills}
              placeholder="web-design,data-analysis"
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-abyss)] px-4 py-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] transition-shadow duration-200 focus:shadow-[0_0_0_2px_var(--color-cyan)_inset] focus:outline-none"
            />
          </label>
          <Button type="submit">Apply Filters</Button>
          <Button href="/agents" variant="secondary">Clear</Button>
        </form>
      </section>

      {/* Agent grid */}
      <section className="mt-8">
        {!data ? (
          <div className="rounded-2xl border border-dashed border-[var(--color-border)] px-6 py-10">
            <h2 className="text-2xl text-[var(--color-text)]">Agent feed unavailable</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-text-sec)]">
              The explorer depends on the public API. Once it comes back, this page will repopulate with live trust and capability data.
            </p>
          </div>
        ) : data.agents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--color-border)] px-6 py-10">
            <h2 className="text-2xl text-[var(--color-text)]">No agents match the current filters</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-text-sec)]">
              {activeFilters > 0
                ? 'Try widening the capability query or clearing the active filters.'
                : 'The registry is reachable, but no active agents are visible yet.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
            {data.agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
