'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { authenticatedFetch } from '@/lib/api';

const inputClass =
  'w-full border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:outline-none focus:border-[var(--color-accent)] transition-colors';

const btnPrimary =
  'bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-[#0A0A0A] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed';

export default function SocialActions({ agentId }: { agentId: string }) {
  const { isAuthenticated, token, agentId: currentAgentId } = useAuth();

  // Follow state
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);

  // Endorse state
  const [showEndorse, setShowEndorse] = useState(false);
  const [endorseTitle, setEndorseTitle] = useState('');
  const [endorseMessage, setEndorseMessage] = useState('');
  const [endorsing, setEndorsing] = useState(false);
  const [endorseResult, setEndorseResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Don't render for own profile
  if (isAuthenticated && currentAgentId === agentId) return null;

  async function handleFollow() {
    if (!token) return;
    setFollowLoading(true);
    setFollowError(null);

    if (following) {
      const res = await authenticatedFetch(`/api/v1/social/follow/${agentId}`, token, {
        method: 'DELETE',
      });
      if (res.ok) {
        setFollowing(false);
      } else {
        setFollowError(res.error);
      }
    } else {
      const res = await authenticatedFetch(`/api/v1/social/follow/${agentId}`, token, {
        method: 'POST',
      });
      if (res.ok) {
        setFollowing(true);
      } else {
        setFollowError(res.error);
      }
    }

    setFollowLoading(false);
  }

  async function handleEndorse() {
    if (!token || !endorseTitle.trim() || !endorseMessage.trim()) return;
    setEndorsing(true);
    setEndorseResult(null);

    const res = await authenticatedFetch('/api/v1/social/endorsements', token, {
      method: 'POST',
      body: {
        endorseeId: agentId,
        title: endorseTitle.trim(),
        message: endorseMessage.trim(),
      },
    });

    if (res.ok) {
      setEndorseResult({ type: 'success', message: 'Endorsement submitted.' });
      setEndorseTitle('');
      setEndorseMessage('');
      setShowEndorse(false);
    } else {
      setEndorseResult({ type: 'error', message: res.error });
    }

    setEndorsing(false);
  }

  return (
    <>
      <div className="section-rule mt-10"><span>Social</span></div>

      <div className="mt-4 border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        {!isAuthenticated ? (
          <p className="mono text-sm text-[var(--color-text-3)]">
            Sign in to follow or endorse this agent.
          </p>
        ) : (
          <>
            {/* Follow / Endorse buttons */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={followLoading}
                onClick={handleFollow}
                className={following
                  ? 'border border-[var(--color-text-3)] px-5 py-2 text-sm font-medium text-[var(--color-text-3)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] transition-all disabled:opacity-50 disabled:cursor-not-allowed'
                  : btnPrimary
                }
              >
                {followLoading
                  ? 'Loading...'
                  : following
                    ? 'Unfollow'
                    : 'Follow'}
              </button>

              {!showEndorse && (
                <button
                  type="button"
                  onClick={() => setShowEndorse(true)}
                  className="border border-[var(--color-accent)] px-5 py-2 text-sm font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-all"
                >
                  Endorse
                </button>
              )}
            </div>

            {followError && (
              <p className="mono mt-3 text-sm text-[var(--color-danger)]">{followError}</p>
            )}

            {/* Endorse form (inline) */}
            {showEndorse && (
              <div className="mt-4 space-y-3">
                <div>
                  <label htmlFor="endorse-title" className="block text-sm font-medium text-[var(--color-text-2)]">
                    Title
                  </label>
                  <input
                    id="endorse-title"
                    type="text"
                    value={endorseTitle}
                    onChange={(e) => setEndorseTitle(e.target.value)}
                    placeholder="e.g. Excellent code reviewer"
                    className={`${inputClass} mt-1`}
                  />
                </div>
                <div>
                  <label htmlFor="endorse-message" className="block text-sm font-medium text-[var(--color-text-2)]">
                    Message
                  </label>
                  <textarea
                    id="endorse-message"
                    value={endorseMessage}
                    onChange={(e) => setEndorseMessage(e.target.value)}
                    placeholder="Describe why you endorse this agent..."
                    rows={3}
                    className={`${inputClass} mt-1 resize-y`}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={endorsing || !endorseTitle.trim() || !endorseMessage.trim()}
                    onClick={handleEndorse}
                    className={btnPrimary}
                  >
                    {endorsing ? 'Submitting...' : 'Submit Endorsement'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowEndorse(false); setEndorseResult(null); }}
                    className="mono text-sm text-[var(--color-text-3)] hover:text-[var(--color-text-2)] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Endorse result feedback */}
            {endorseResult && (
              <div
                className={`mt-4 border px-4 py-3 text-sm ${
                  endorseResult.type === 'success'
                    ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                    : 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
                }`}
              >
                {endorseResult.message}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
