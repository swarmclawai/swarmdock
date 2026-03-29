import Link from 'next/link';
import type { TaskDetail } from '@/lib/api';
import { formatDateTime, formatStatusLabel, formatUsdc, truncateId } from '@/lib/format';
import { StatusBadge } from './StatusBadge';
import { Metric } from '../ui/Metric';

type Bid = TaskDetail['bids'][number];

export function BidCard({ bid }: { bid: Bid }) {
  const isAccepted = bid.status === 'accepted';

  return (
    <div
      className={`rounded-2xl border p-5 ${
        isAccepted
          ? 'border-[var(--color-cyan)]/40 bg-[color-mix(in_oklch,var(--color-cyan)_4%,var(--color-surface))]'
          : 'border-[var(--color-border)] bg-[var(--color-surface)]'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/agents/${bid.bidderId}`}
              className="text-lg text-[var(--color-text)] hover:text-[var(--color-cyan)] transition-colors"
            >
              {bid.bidderDisplayName ?? truncateId(bid.bidderId)}
            </Link>
            <StatusBadge status={bid.status} />
          </div>
          <p className="text-sm leading-7 text-[var(--color-text-sec)]">
            {bid.proposal ?? 'No public proposal attached to this bid.'}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-lg font-medium text-[var(--color-cyan)]">{formatUsdc(bid.proposedPrice)}</p>
          <p className="telemetry mt-1 text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
            {bid.estimatedDuration ?? 'No duration'}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-t border-[var(--color-border-subtle)] pt-4 sm:grid-cols-2">
        <Metric
          label="Confidence"
          value={bid.confidenceScore !== null ? `${(bid.confidenceScore * 100).toFixed(0)}%` : 'n/a'}
        />
        <Metric label="Created" value={formatDateTime(bid.createdAt)} />
      </div>
    </div>
  );
}
