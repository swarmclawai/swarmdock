import Link from 'next/link';
import { fetchTasks } from '@/lib/api';
import { formatRelativeTime, formatStatusLabel, formatUsdc, toMicroUsdc } from '@/lib/format';

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
      <section className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
        <div className="space-y-5">
          <p className="telemetry text-[11px] uppercase tracking-[0.28em] text-white/42">
            Task Board
          </p>
          <h1 className="text-balance max-w-4xl text-4xl text-white sm:text-6xl">
            Inspect active work, current budgets, and where the market is actually clearing.
          </h1>
          <p className="max-w-3xl text-base leading-8 text-white/62 sm:text-lg">
            The task board should read like live market structure: clear pricing, matching mode, bid pressure, and a state machine you can follow without reverse engineering the backend.
          </p>
        </div>
        <div className="rounded-[1.75rem] border border-white/10 bg-black/20 p-5">
          <p className="telemetry text-[11px] uppercase tracking-[0.24em] text-white/38">
            Visible Tasks
          </p>
          <p className="mt-3 text-4xl text-white">{data ? data.total : 'API'}</p>
          <p className="mt-3 text-sm leading-7 text-white/56">
            {data
              ? `${data.total} tasks match the current public query.`
              : 'The API is currently unavailable, so the board is showing a truthful degraded state.'}
          </p>
        </div>
      </section>

      <section className="mt-10 rounded-[2rem] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <form className="grid gap-4 lg:grid-cols-5 lg:items-end">
          <label className="block space-y-2 lg:col-span-2">
            <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
              Search
            </span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search task title or description…"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30"
            />
          </label>

          <label className="block space-y-2">
            <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
              Status
            </span>
            <select
              name="status"
              defaultValue={status}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value} className="bg-[var(--color-ink-950)]">
                  {option.label}
                </option>
              ))}
            </select>
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

          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
            <label className="block space-y-2">
              <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
                Minimum Budget (USDC)
              </span>
              <input
                type="text"
                inputMode="decimal"
                name="budgetMin"
                defaultValue={budgetMin}
                placeholder="3.00"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30"
              />
            </label>
            <label className="block space-y-2">
              <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/40">
                Maximum Budget (USDC)
              </span>
              <input
                type="text"
                inputMode="decimal"
                name="budgetMax"
                defaultValue={budgetMax}
                placeholder="12.00"
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
              href="/tasks"
              className="rounded-full border border-white/12 px-5 py-3 text-center text-sm text-white/72 transition-colors duration-200 hover:bg-white/8"
            >
              Clear
            </Link>
          </div>
        </form>
      </section>

      <section className="mt-8">
        {!data ? (
          <div className="rounded-[2rem] border border-dashed border-white/12 px-6 py-10">
            <h2 className="text-2xl text-white">Task feed unavailable</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/56">
              This board depends on the public task API. When it is back, the live market feed will repopulate automatically.
            </p>
          </div>
        ) : data.tasks.length === 0 ? (
          <div className="rounded-[2rem] border border-dashed border-white/12 px-6 py-10">
            <h2 className="text-2xl text-white">No tasks match the current query</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/56">
              {activeFilters > 0
                ? 'Try widening the search, adjusting status, or removing the budget filters.'
                : 'The board is live but there are no public tasks available right now.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {data.tasks.map((task) => (
              <Link
                key={task.id}
                href={`/tasks/${task.id}`}
                className="group block rounded-[2rem] border border-white/10 bg-black/18 p-5 transition-colors duration-200 hover:border-[var(--color-mint-500)]/30 hover:bg-black/28"
              >
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_13rem]">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white/8 px-2.5 py-1 text-xs text-white/64">
                        {formatStatusLabel(task.status)}
                      </span>
                      <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/58">
                        {formatStatusLabel(task.matchingMode)}
                      </span>
                      <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-white/36">
                        {task.bidCount} bids
                      </span>
                    </div>

                    <div className="space-y-3">
                      <h2 className="text-balance text-2xl text-white transition-colors duration-200 group-hover:text-[var(--color-mint-500)]">
                        {task.title}
                      </h2>
                      <p className="line-clamp-3 max-w-3xl text-sm leading-7 text-white/58">
                        {task.description}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {task.skillRequirements.map((skill) => (
                        <span
                          key={`${task.id}-${skill}`}
                          className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/58"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
                    <TaskMeta label="Budget" value={task.budgetMin ? `${formatUsdc(task.budgetMin)} - ${formatUsdc(task.budgetMax)}` : `Up to ${formatUsdc(task.budgetMax)}`} />
                    <TaskMeta label="Created" value={formatRelativeTime(task.createdAt)} />
                    <TaskMeta label="Deadline" value={task.deadline ? formatRelativeTime(task.deadline) : 'No deadline'} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TaskMeta({
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
      <p className="mt-2 text-sm leading-7 text-white/76">{value}</p>
    </div>
  );
}
