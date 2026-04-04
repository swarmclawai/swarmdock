'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { authenticatedFetch } from '@/lib/api';

const inputClass =
  'w-full border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors';

export default function TaskActions({
  taskId,
  status,
  requesterId,
}: {
  taskId: string;
  status: string;
  requesterId: string | null;
}) {
  const router = useRouter();
  const { isAuthenticated, token, agentId } = useAuth();
  const [reason, setReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [submitting, setSubmitting] = useState<'approve' | 'reject' | null>(null);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  if (status !== 'review' || !requesterId) return null;

  const isRequester = isAuthenticated && agentId === requesterId;

  async function handleAction(action: 'approve' | 'reject') {
    setResult(null);

    if (!isAuthenticated || !token) {
      setResult({ type: 'error', message: 'Sign in first using the button in the navbar.' });
      return;
    }

    if (!isRequester) {
      setResult({ type: 'error', message: 'Only the task requester can approve or reject.' });
      return;
    }

    setSubmitting(action);

    const body: Record<string, string> = {};
    if (action === 'reject' && reason.trim()) {
      body.reason = reason.trim();
    }

    const res = await authenticatedFetch(`/api/v1/tasks/${taskId}/${action}`, token, {
      method: 'POST',
      body,
    });

    if (!res.ok) {
      setResult({ type: 'error', message: res.error });
      setSubmitting(null);
      return;
    }

    setResult({
      type: 'success',
      message: action === 'approve'
        ? 'Task approved. Escrow released to assignee.'
        : 'Task rejected. Returned for revision.',
    });
    setSubmitting(null);
    router.refresh();
  }

  return (
    <>
      <div className="section-rule mt-10"><span>Review Actions</span></div>

      <div className="mt-4 border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        {!isAuthenticated ? (
          <p className="mono text-sm text-[var(--color-text-3)]">
            Sign in to review this task.
          </p>
        ) : !isRequester ? (
          <p className="mono text-sm text-[var(--color-text-3)]">
            Only the task requester can approve or reject.
          </p>
        ) : (
          <>
            <p className="mono text-sm text-[var(--color-text-2)]">
              This task is awaiting your review. Approve to release escrow, or reject to request revisions.
            </p>

            {/* Reject reason (collapsible) */}
            {showReject && (
              <div className="mt-4">
                <label htmlFor="task-reject-reason" className="block text-sm font-medium text-[var(--color-text-2)]">
                  Rejection Reason
                </label>
                <textarea
                  id="task-reject-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe why the deliverables are insufficient..."
                  rows={3}
                  className={`${inputClass} mt-1 resize-y`}
                />
                <p className="mono mt-1 text-xs text-[var(--color-text-3)]">
                  Optional. Sent to the assignee agent.
                </p>
              </div>
            )}

            {/* Feedback */}
            {result && (
              <div
                className={`mt-4 border px-4 py-3 text-sm ${
                  result.type === 'success'
                    ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                    : 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
                }`}
              >
                {result.message}
              </div>
            )}

            {/* Buttons */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={submitting !== null}
                onClick={() => handleAction('approve')}
                className="bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-[#0A0A0A] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting === 'approve' ? 'Approving...' : 'Approve'}
              </button>
              {!showReject ? (
                <button
                  type="button"
                  disabled={submitting !== null}
                  onClick={() => setShowReject(true)}
                  className="border border-[var(--color-danger)] px-5 py-2 text-sm font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Reject...
                </button>
              ) : (
                <button
                  type="button"
                  disabled={submitting !== null}
                  onClick={() => handleAction('reject')}
                  className="bg-[var(--color-danger)] px-5 py-2 text-sm font-medium text-[#0A0A0A] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting === 'reject' ? 'Rejecting...' : 'Confirm Reject'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
