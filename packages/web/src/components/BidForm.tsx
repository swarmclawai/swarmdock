'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { authenticatedFetch } from '@/lib/api';

const inputClass =
  'w-full border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors';

export default function BidForm({ taskId, status }: { taskId: string; status: string }) {
  const { isAuthenticated, token } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const canBid = status === 'open' || status === 'bidding';
  if (!canBid) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);

    if (!isAuthenticated || !token) {
      setResult({ type: 'error', message: 'Sign in first using the button in the navbar.' });
      return;
    }

    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    const priceUsd = parseFloat((form.get('price') as string) || '0');
    const confidence = parseFloat((form.get('confidence') as string) || '0.8');
    const proposal = (form.get('proposal') as string).trim();
    const duration = (form.get('duration') as string).trim();

    const body: Record<string, unknown> = {
      proposedPrice: String(Math.round(priceUsd * 1_000_000)),
      confidenceScore: Math.min(1, Math.max(0, confidence)),
    };
    if (proposal) body.proposal = proposal;
    if (duration) body.estimatedDuration = duration;

    const res = await authenticatedFetch(`/api/v1/tasks/${taskId}/bids`, token, {
      method: 'POST',
      body,
    });

    if (!res.ok) {
      setResult({ type: 'error', message: res.error });
    } else {
      setResult({ type: 'success', message: 'Bid submitted successfully.' });
      router.refresh();
    }
    setSubmitting(false);
  }

  return (
    <>
      <div className="section-rule mt-10"><span>Place Bid</span></div>
      <div className="mt-4 border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        {!isAuthenticated ? (
          <p className="mono text-sm text-[var(--color-text-3)]">Sign in to place a bid on this task.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="bid-price" className="block text-sm font-medium text-[var(--color-text-2)]">Price (USDC)</label>
                <input id="bid-price" name="price" type="number" required min={0} step="0.01" placeholder="5.00" className={`${inputClass} mt-1`} />
              </div>
              <div>
                <label htmlFor="bid-confidence" className="block text-sm font-medium text-[var(--color-text-2)]">Confidence (0-1)</label>
                <input id="bid-confidence" name="confidence" type="number" min={0} max={1} step="0.01" defaultValue="0.8" className={`${inputClass} mt-1`} />
              </div>
            </div>
            <div>
              <label htmlFor="bid-duration" className="block text-sm font-medium text-[var(--color-text-2)]">Est. Duration</label>
              <input id="bid-duration" name="duration" type="text" placeholder="e.g. PT2H (ISO 8601)" className={`${inputClass} mt-1`} />
            </div>
            <div>
              <label htmlFor="bid-proposal" className="block text-sm font-medium text-[var(--color-text-2)]">Proposal</label>
              <textarea id="bid-proposal" name="proposal" rows={3} maxLength={5000}
                placeholder="Describe your approach and why you're the best fit..."
                className={`${inputClass} mt-1 resize-y`} />
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
              {submitting ? 'Submitting...' : 'Submit Bid'}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
