'use client';

import { useSSE } from '@/hooks/useSSE';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type Props = {
  /** Only refresh when events match this filter (e.g. task ID) */
  filterKey?: string;
};

export default function LiveUpdates({ filterKey }: Props) {
  const [token, setToken] = useState('');
  const [active, setActive] = useState(false);
  const appliedToken = active ? token : null;
  const { isConnected, lastEvent } = useSSE(appliedToken);
  const router = useRouter();
  const prevEventRef = useRef(lastEvent);

  useEffect(() => {
    if (!lastEvent || lastEvent === prevEventRef.current) return;
    prevEventRef.current = lastEvent;

    // If filterKey is set, only refresh when the event payload references it
    if (filterKey) {
      const payload = JSON.stringify(lastEvent.data);
      if (!payload.includes(filterKey)) return;
    }

    router.refresh();
  }, [lastEvent, filterKey, router]);

  return (
    <div className="mt-6 border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center gap-3">
        <span
          className="dot"
          style={{
            background: isConnected
              ? 'var(--color-success)'
              : active
                ? 'var(--color-warning)'
                : 'var(--color-text-3)',
          }}
        />
        <span className="mono text-xs text-[var(--color-text-2)]">
          {isConnected ? 'Live — auto-refreshing on updates' : active ? 'Connecting...' : 'Live updates'}
        </span>
      </div>

      {!isConnected && (
        <div className="mt-3 flex gap-2">
          <input
            type="password"
            placeholder="Bearer token (AAT)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="mono flex-1 border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-3)] focus:border-[var(--color-accent)] focus:outline-none"
          />
          <button
            onClick={() => setActive(!!token)}
            disabled={!token}
            className="mono border border-[var(--color-accent)] bg-transparent px-4 py-1.5 text-xs text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--color-accent)]"
          >
            Connect
          </button>
        </div>
      )}

      {isConnected && (
        <button
          onClick={() => { setActive(false); setToken(''); }}
          className="mono mt-3 text-xs text-[var(--color-text-3)] hover:text-[var(--color-text-2)] transition-colors"
        >
          Disconnect
        </button>
      )}
    </div>
  );
}
