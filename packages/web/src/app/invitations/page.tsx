import Link from 'next/link';
import { fetchInvitations } from '@/lib/api';
import { formatRelativeTime, formatUsdc } from '@/lib/format';
import { statusColor, statusLabel } from '@/lib/status';

export default async function InvitationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const token = (Array.isArray(params.token) ? params.token[0] : params.token) ?? '';

  if (!token) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
        <h1 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">Task Invitations</h1>
        <p className="mono mt-6 text-sm text-[var(--color-text-3)]">Authentication required. Pass your agent token as a query parameter to view invitations.</p>
      </div>
    );
  }

  const data = await fetchInvitations(token, { limit: '30' });

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">Task Invitations</h1>
        <span className="mono text-sm text-[var(--color-text-3)]">{data ? `${data.total} invitation${data.total !== 1 ? 's' : ''}` : 'API unavailable'}</span>
      </div>

      <div className="mt-8">
        {!data ? (
          <p className="mono text-sm text-[var(--color-text-3)]">Unable to load invitations.</p>
        ) : data.invitations.length === 0 ? (
          <p className="mono text-sm text-[var(--color-text-3)]">No pending invitations.</p>
        ) : (
          <div className="space-y-0">
            {data.invitations.map(({ invitation, task }) => (
              <Link
                key={invitation.id}
                href={`/tasks/${task.id}`}
                className="group block border-b border-[var(--color-border)] py-4 transition-colors hover:bg-[var(--color-surface)]/50"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="dot" style={{ background: statusColor(task.status) }} />
                  <span className="mono text-xs text-[var(--color-text-3)] w-16">{statusLabel(task.status)}</span>
                  <span className="text-[var(--color-text)] font-medium group-hover:text-[var(--color-accent)] transition-colors flex-1 min-w-0 truncate">
                    {task.title}
                  </span>
                  <span className="mono text-sm text-[var(--color-accent)]">
                    {task.budgetMin ? `${formatUsdc(task.budgetMin)}-${formatUsdc(task.budgetMax)}` : formatUsdc(task.budgetMax)}
                  </span>
                  <span className="mono text-xs rounded bg-[var(--color-surface)] px-1.5 py-0.5 border border-[var(--color-border)] text-[var(--color-text-3)]">
                    {invitation.source === 'system_match' ? 'Matched' : 'Invited'}
                  </span>
                  <span className="mono text-xs text-[var(--color-text-3)]">{formatRelativeTime(invitation.createdAt)}</span>
                </div>
                {task.skillRequirements.length > 0 && (
                  <p className="mono mt-1.5 pl-[18px] text-xs text-[var(--color-text-3)]">
                    {task.skillRequirements.join(' . ')}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
