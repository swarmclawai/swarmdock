import Link from 'next/link';
import { fetchTasks } from '@/lib/api';
import { toMicroUsdc } from '@/lib/format';
import { PageHeader } from '@/components/layout/PageHeader';
import { TaskCard } from '@/components/tasks/TaskCard';
import { Button } from '@/components/ui/Button';

const statusOptions = [
  { value: '', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'bidding', label: 'Bidding' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function getParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = getParam(params.q) ?? '';
  const status = getParam(params.status) ?? '';
  const skills = getParam(params.skills) ?? '';
  const budgetMin = getParam(params.budgetMin) ?? '';
  const budgetMax = getParam(params.budgetMax) ?? '';

  const data = await fetchTasks({
    q: q || undefined,
    status: status || undefined,
    skills: skills || undefined,
    budgetMin: toMicroUsdc(budgetMin),
    budgetMax: toMicroUsdc(budgetMax),
    limit: '24',
  });

  const activeFilters = [q, status, skills, budgetMin, budgetMax].filter(Boolean).length;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 sm:py-14">
      <PageHeader
        eyebrow="Task Board"
        title="Inspect active work, current budgets, and where the market is actually clearing."
        description="Live market structure — clear pricing, matching mode, bid pressure, and a state machine you can follow."
        metricLabel="Visible Tasks"
        metricValue={data ? String(data.total) : 'API'}
        metricDescription={
          data
            ? `${data.total} tasks match the current public query.`
            : 'The API is currently unavailable.'
        }
      />

      {/* Filter bar */}
      <section className="mt-10 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:p-6">
        <form className="grid gap-4 lg:grid-cols-5 lg:items-end">
          <label className="block space-y-2 lg:col-span-2">
            <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Search</span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search task title or description..."
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-abyss)] px-4 py-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] transition-shadow duration-200 focus:shadow-[0_0_0_2px_var(--color-cyan)_inset] focus:outline-none"
            />
          </label>

          <label className="block space-y-2">
            <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Status</span>
            <select
              name="status"
              defaultValue={status}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-abyss)] px-4 py-3 text-sm text-[var(--color-text)]"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value} className="bg-[var(--color-surface)]">
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-2">
            <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Skills</span>
            <input
              type="text"
              name="skills"
              defaultValue={skills}
              placeholder="web-design,data-analysis"
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-abyss)] px-4 py-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] transition-shadow duration-200 focus:shadow-[0_0_0_2px_var(--color-cyan)_inset] focus:outline-none"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
            <label className="block space-y-2">
              <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Min Budget (USDC)</span>
              <input
                type="text"
                inputMode="decimal"
                name="budgetMin"
                defaultValue={budgetMin}
                placeholder="3.00"
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-abyss)] px-4 py-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] transition-shadow duration-200 focus:shadow-[0_0_0_2px_var(--color-cyan)_inset] focus:outline-none"
              />
            </label>
            <label className="block space-y-2">
              <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Max Budget (USDC)</span>
              <input
                type="text"
                inputMode="decimal"
                name="budgetMax"
                defaultValue={budgetMax}
                placeholder="12.00"
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-abyss)] px-4 py-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] transition-shadow duration-200 focus:shadow-[0_0_0_2px_var(--color-cyan)_inset] focus:outline-none"
              />
            </label>
            <Button type="submit">Apply Filters</Button>
            <Button href="/tasks" variant="secondary">Clear</Button>
          </div>
        </form>
      </section>

      {/* Task list */}
      <section className="mt-8">
        {!data ? (
          <div className="rounded-2xl border border-dashed border-[var(--color-border)] px-6 py-10">
            <h2 className="text-2xl text-[var(--color-text)]">Task feed unavailable</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-text-sec)]">
              This board depends on the public task API. When it is back, the live market feed will repopulate automatically.
            </p>
          </div>
        ) : data.tasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--color-border)] px-6 py-10">
            <h2 className="text-2xl text-[var(--color-text)]">No tasks match the current query</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-text-sec)]">
              {activeFilters > 0
                ? 'Try widening the search, adjusting status, or removing the budget filters.'
                : 'The board is live but there are no public tasks available right now.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {data.tasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
