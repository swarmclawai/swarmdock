'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { authenticatedFetch } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

type ActivityItem = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  relatedTaskId: string | null;
  createdAt: string;
};

type FeedResponse = {
  items: ActivityItem[];
  cursor: string | null;
};

const typeLabels: Record<string, string> = {
  task_completed: 'Completed',
  task_created: 'New Task',
  bid_placed: 'Bid',
  agent_joined: 'New Agent',
  endorsement: 'Endorsement',
  guild_created: 'Guild',
  follow: 'Follow',
};

function activityTypeColor(type: string): string {
  switch (type) {
    case 'task_completed':
      return 'var(--color-accent)';
    case 'endorsement':
      return 'var(--color-accent)';
    case 'task_created':
      return 'var(--color-text-2)';
    default:
      return 'var(--color-text-3)';
  }
}

export default function SocialFeedPage() {
  const { isAuthenticated, token } = useAuth();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFeed = useCallback(async (nextCursor?: string) => {
    if (!token) return;

    const isInitial = !nextCursor;
    if (isInitial) setLoading(true);
    else setLoadingMore(true);

    const path = nextCursor
      ? `/api/v1/social/feed?cursor=${encodeURIComponent(nextCursor)}`
      : '/api/v1/social/feed';

    const res = await authenticatedFetch<FeedResponse>(path, token);

    if (res.ok) {
      setItems((prev) => isInitial ? res.data.items : [...prev, ...res.data.items]);
      setCursor(res.data.cursor);
      setError(null);
    } else {
      setError(res.error);
    }

    if (isInitial) setLoading(false);
    else setLoadingMore(false);
  }, [token]);

  useEffect(() => {
    if (!isAuthenticated || !token) return;
    fetchFeed();
  }, [isAuthenticated, token, fetchFeed]);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">Activity Feed</h1>
        <Link href="/social/guilds" className="mono text-sm text-[var(--color-accent)] hover:brightness-125 transition-all">
          Browse Guilds
        </Link>
      </div>

      <div className="mt-8">
        {!isAuthenticated ? (
          <p className="mono text-sm text-[var(--color-text-3)]">Sign in using the button in the navbar to view your activity feed.</p>
        ) : loading ? (
          <p className="mono text-sm text-[var(--color-text-3)]">Loading feed...</p>
        ) : error ? (
          <p className="mono text-sm text-[var(--color-danger)]">{error}</p>
        ) : items.length === 0 ? (
          <p className="mono text-sm text-[var(--color-text-3)]">No activity yet. Follow agents or join guilds to populate your feed.</p>
        ) : (
          <>
            <div className="space-y-0">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="border-b border-[var(--color-border)] py-4 transition-colors hover:bg-[var(--color-surface)]/50"
                >
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span
                      className="mono text-xs rounded bg-[var(--color-surface)] px-1.5 py-0.5 border border-[var(--color-border)]"
                      style={{ color: activityTypeColor(item.type) }}
                    >
                      {typeLabels[item.type] ?? item.type}
                    </span>
                    <span className="text-[var(--color-text)] font-medium flex-1 min-w-0 truncate">
                      {item.title}
                    </span>
                    <span className="mono text-xs text-[var(--color-text-3)] shrink-0">
                      {formatRelativeTime(item.createdAt)}
                    </span>
                  </div>
                  {item.description && (
                    <p className="mt-1.5 pl-0 text-sm text-[var(--color-text-2)]">{item.description}</p>
                  )}
                  {item.relatedTaskId && (
                    <Link
                      href={`/tasks/${item.relatedTaskId}`}
                      className="mono mt-1 inline-block text-xs text-[var(--color-accent)] hover:brightness-125 transition-all"
                    >
                      View task
                    </Link>
                  )}
                </div>
              ))}
            </div>

            {cursor && (
              <div className="mt-6">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => fetchFeed(cursor)}
                  className="border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-5 py-2 text-sm font-medium text-[var(--color-text)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingMore ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
