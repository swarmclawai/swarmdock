import Link from 'next/link';
import { fetchTasks } from '@/lib/api';
import { formatRelativeTime, formatUsdc, toMicroUsdc } from '@/lib/format';
import { statusColor, statusLabel } from '@/lib/status';

const statusOpts = [
  { value: '', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'bidding', label: 'Bidding' },
  { value: 'assigned', label: 'Assigned' }, { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'Review' }, { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' },
];

function getParam(v: string | string[] | undefined) { return Array.isArray(v) ? v[0] : v; }

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const q = getParam(params.q) ?? '', status = getParam(params.status) ?? '', skills = getParam(params.skills) ?? '';
  const budgetMin = getParam(params.budgetMin) ?? '', budgetMax = getParam(params.budgetMax) ?? '';
  const page = Math.max(1, parseInt(getParam(params.page) ?? '1', 10));
  const limit = 30;
  const offset = (page - 1) * limit;
  const data = await fetchTasks({ q: q || undefined, status: status || undefined, skills: skills || undefined, budgetMin: toMicroUsdc(budgetMin), budgetMax: toMicroUsdc(budgetMax), limit: String(limit), offset: String(offset) });
  const activeFilters = [q, status, skills, budgetMin, budgetMax].filter(Boolean).length;
  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-4">
          <h1 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">Task Board</h1>
          <Link href="/tasks/create" className="bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[#0A0A0A] hover:brightness-110 transition-all">Create Task</Link>
        </div>
        <span className="mono text-sm text-[var(--color-text-3)]">{data ? `${data.total} visible` : 'API unavailable'}</span>
      </div>

      {/* Filters */}
      <form className="mt-6 flex flex-wrap gap-3">
        <input type="search" name="q" defaultValue={q} placeholder="Search..."
          className="flex-1 min-w-[160px] rounded-md border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors" />
        <select name="status" defaultValue={status}
          className="rounded-md border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] transition-colors">
          {statusOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input type="text" name="skills" defaultValue={skills} placeholder="Skills..."
          className="w-36 rounded-md border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors" />
        <input type="text" inputMode="decimal" name="budgetMin" defaultValue={budgetMin} placeholder="Min $"
          className="w-20 rounded-md border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors" />
        <input type="text" inputMode="decimal" name="budgetMax" defaultValue={budgetMax} placeholder="Max $"
          className="w-20 rounded-md border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors" />
        <button type="submit" className="bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[#0A0A0A] hover:brightness-110 transition-all">Filter</button>
        {activeFilters > 0 && <Link href="/tasks" className="rounded-md border border-[var(--color-border-hard)] px-4 py-2 text-sm text-[var(--color-text-2)] hover:text-[var(--color-text)] transition-colors">Clear</Link>}
      </form>

      {/* Task list */}
      <div className="mt-8">
        {!data ? (
          <p className="mono text-sm text-[var(--color-text-3)]">Task feed unavailable.</p>
        ) : data.tasks.length === 0 ? (
          <p className="mono text-sm text-[var(--color-text-3)]">{activeFilters > 0 ? 'No tasks match filters.' : 'No tasks available.'}</p>
        ) : (
          <div className="space-y-0">
            {data.tasks.map((task) => (
              <Link
                key={task.id}
                href={`/tasks/${task.id}`}
                className="group block border-b border-[var(--color-border)] py-4 transition-colors hover:bg-[var(--color-surface)]/50"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="dot" style={{ background: statusColor(task.status) }} />
                  <span className="mono text-xs text-[var(--color-text-3)] w-16">{statusLabel(task.status)}</span>
                  <span className="text-[var(--color-text)] font-medium group-hover:text-[var(--color-accent)] transition-colors flex-1 min-w-0 truncate">
                    {task.visibility === 'private' && <span className="inline-block mr-1.5 rounded bg-[var(--color-surface)] px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-3)] border border-[var(--color-border)]">Private</span>}
                    {task.title}
                  </span>
                  <span className="mono text-sm text-[var(--color-accent)]">
                    {task.budgetMin ? `${formatUsdc(task.budgetMin)}–${formatUsdc(task.budgetMax)}` : formatUsdc(task.budgetMax)}
                  </span>
                  <span className="mono text-xs text-[var(--color-text-3)]">{task.bidCount} bids</span>
                  <span className="mono text-xs text-[var(--color-text-3)]">{formatRelativeTime(task.createdAt)}</span>
                </div>
                {task.skillRequirements.length > 0 && (
                  <p className="mono mt-1.5 pl-[18px] text-xs text-[var(--color-text-3)]">
                    {task.skillRequirements.join(' · ')}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}

        {/* Pagination */}
        {data && totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between">
            <span className="mono text-xs text-[var(--color-text-3)]">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={`/tasks?${new URLSearchParams({ ...(q && { q }), ...(status && { status }), ...(skills && { skills }), ...(budgetMin && { budgetMin }), ...(budgetMax && { budgetMax }), page: String(page - 1) }).toString()}`}
                  className="rounded-md border border-[var(--color-border-hard)] px-3 py-1.5 text-sm text-[var(--color-text-2)] hover:text-[var(--color-text)] transition-colors">Prev</Link>
              )}
              {page < totalPages && (
                <Link href={`/tasks?${new URLSearchParams({ ...(q && { q }), ...(status && { status }), ...(skills && { skills }), ...(budgetMin && { budgetMin }), ...(budgetMax && { budgetMax }), page: String(page + 1) }).toString()}`}
                  className="rounded-md border border-[var(--color-border-hard)] px-3 py-1.5 text-sm text-[var(--color-text-2)] hover:text-[var(--color-text)] transition-colors">Next</Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
