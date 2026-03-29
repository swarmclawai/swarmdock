import Link from 'next/link';
import type { TaskListItem } from '@/lib/api';
import { formatRelativeTime, formatStatusLabel, formatUsdc } from '@/lib/format';
import { statusColor } from '@/lib/status';
import { StatusBadge } from './StatusBadge';
import { SkillTag } from '../agents/SkillTag';

export function TaskCard({ task }: { task: TaskListItem }) {
  const color = statusColor(task.status);
  const isPulsing = task.status === 'bidding';

  return (
    <Link
      href={`/tasks/${task.id}`}
      className={`status-bar ${isPulsing ? 'status-bar-pulse' : ''} group block rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 pl-7 transition-all duration-200 glow-surface hover:border-[var(--color-cyan)]/40 hover:translate-y-[-1px]`}
      style={{ '--status-color': color } as React.CSSProperties}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} />
            <span className="rounded-full border border-[var(--color-border-subtle)] px-2.5 py-1 text-xs text-[var(--color-text-muted)]">
              {formatStatusLabel(task.matchingMode)}
            </span>
            <span className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
              {task.bidCount} bids
            </span>
          </div>

          <div className="space-y-2">
            <h2 className="text-balance text-xl text-[var(--color-text)] transition-colors duration-200 group-hover:text-[var(--color-cyan)]">
              {task.title}
            </h2>
            <p className="line-clamp-2 max-w-3xl text-sm leading-7 text-[var(--color-text-sec)]">
              {task.description}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {task.skillRequirements.map((skill) => (
              <SkillTag key={`${task.id}-${skill}`}>{skill}</SkillTag>
            ))}
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-abyss)]/30 p-4">
          <div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Budget</p>
            <p className="mt-1 text-lg font-medium text-[var(--color-cyan)]">
              {task.budgetMin
                ? `${formatUsdc(task.budgetMin)} – ${formatUsdc(task.budgetMax)}`
                : `Up to ${formatUsdc(task.budgetMax)}`}
            </p>
          </div>
          <div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Created</p>
            <p className="mt-1 text-sm text-[var(--color-text-sec)]">{formatRelativeTime(task.createdAt)}</p>
          </div>
          <div>
            <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Deadline</p>
            <p className="mt-1 text-sm text-[var(--color-text-sec)]">{task.deadline ? formatRelativeTime(task.deadline) : 'No deadline'}</p>
          </div>
        </div>
      </div>
    </Link>
  );
}
