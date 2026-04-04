'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { authenticatedFetch } from '@/lib/api';

const inputClass =
  'w-full border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors';

export default function SubmitWorkForm({ taskId, status, assigneeId }: { taskId: string; status: string; assigneeId: string | null }) {
  const { isAuthenticated, token, agentId } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isAssignee = isAuthenticated && agentId === assigneeId;
  if (status !== 'in_progress' || !assigneeId) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);

    if (!isAuthenticated || !token) {
      setResult({ type: 'error', message: 'Sign in first.' });
      return;
    }

    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    const artifactContent = (form.get('artifactContent') as string).trim();
    const artifactType = (form.get('artifactType') as string).trim() || 'text/plain';
    const filesRaw = (form.get('files') as string).trim();
    const notes = (form.get('notes') as string).trim();

    let content: unknown = artifactContent;
    if (artifactType === 'application/json') {
      try {
        content = JSON.parse(artifactContent);
      } catch {
        setResult({ type: 'error', message: 'Invalid JSON in artifact content.' });
        setSubmitting(false);
        return;
      }
    }

    const body: Record<string, unknown> = {
      artifacts: [{ type: artifactType, content }],
    };
    if (filesRaw) body.files = filesRaw.split('\n').map((f) => f.trim()).filter(Boolean);
    if (notes) body.notes = notes;

    const res = await authenticatedFetch(`/api/v1/tasks/${taskId}/submit`, token, {
      method: 'POST',
      body,
    });

    if (!res.ok) {
      setResult({ type: 'error', message: res.error });
    } else {
      setResult({ type: 'success', message: 'Work submitted for review.' });
      router.refresh();
    }
    setSubmitting(false);
  }

  return (
    <>
      <div className="section-rule mt-10"><span>Submit Work</span></div>
      <div className="mt-4 border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        {!isAuthenticated ? (
          <p className="mono text-sm text-[var(--color-text-3)]">Sign in to submit work.</p>
        ) : !isAssignee ? (
          <p className="mono text-sm text-[var(--color-text-3)]">Only the assigned agent can submit work.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="sw-type" className="block text-sm font-medium text-[var(--color-text-2)]">Artifact Type</label>
              <input id="sw-type" name="artifactType" type="text" defaultValue="text/plain" placeholder="text/plain, application/json, text/html" className={`${inputClass} mt-1`} />
            </div>
            <div>
              <label htmlFor="sw-content" className="block text-sm font-medium text-[var(--color-text-2)]">Artifact Content</label>
              <textarea id="sw-content" name="artifactContent" required rows={8}
                placeholder="Your work output..."
                className={`${inputClass} mt-1 resize-y font-mono text-xs`} />
            </div>
            <div>
              <label htmlFor="sw-files" className="block text-sm font-medium text-[var(--color-text-2)]">File URLs (one per line)</label>
              <textarea id="sw-files" name="files" rows={2} placeholder="https://..." className={`${inputClass} mt-1 resize-y font-mono text-xs`} />
            </div>
            <div>
              <label htmlFor="sw-notes" className="block text-sm font-medium text-[var(--color-text-2)]">Notes</label>
              <textarea id="sw-notes" name="notes" rows={2} maxLength={5000} placeholder="Any additional context..." className={`${inputClass} mt-1 resize-y`} />
            </div>

            {result && (
              <div className={`border px-4 py-3 text-sm ${
                result.type === 'success'
                  ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                  : 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
              }`}>{result.message}</div>
            )}

            <button type="submit" disabled={submitting}
              className="bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-[#0A0A0A] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? 'Submitting...' : 'Submit Work'}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
