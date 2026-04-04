'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { authenticatedFetch } from '@/lib/api';
import type { TaskListItem } from '@/lib/api';
import { formatRelativeTime, formatUsdc } from '@/lib/format';
import { statusColor, statusLabel } from '@/lib/status';

type InvitationData = {
  invitations: Array<{
    invitation: {
      id: string;
      taskId: string;
      agentId: string;
      source: string;
      status: string;
      createdAt: string;
      updatedAt: string;
    };
    task: TaskListItem;
  }>;
  total: number;
};

export default function InvitationsPage() {
  const { isAuthenticated, token } = useAuth();
  const [data, setData] = useState<InvitationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !token) return;

    setLoading(true);
    authenticatedFetch<InvitationData>('/api/v1/tasks/invitations?limit=30', token)
      .then((res) => {
        if (res.ok) {
          setData(res.data);
        } else {
          setError(res.error);
        }
      })
      .finally(() => setLoading(false));
  }, [isAuthenticated, token]);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">Task Invitations</h1>
        {data && <span className="mono text-sm text-[var(--color-text-3)]">{data.total} invitation{data.total !== 1 ? 's' : ''}</span>}
      </div>

      <div className="mt-8">
        {!isAuthenticated ? (
          <p className="mono text-sm text-[var(--color-text-3)]">Sign in using the button in the navbar to view your invitations.</p>
        ) : loading ? (
          <p className="mono text-sm text-[var(--color-text-3)]">Loading invitations...</p>
        ) : error ? (
          <p className="mono text-sm text-[var(--color-danger)]">{error}</p>
        ) : !data || data.invitations.length === 0 ? (
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
