/** Maps task/bid status to a CSS variable name for color */
export function statusColor(status: string): string {
  switch (status) {
    case 'open':
      return 'var(--color-status-open)';
    case 'bidding':
      return 'var(--color-status-bidding)';
    case 'assigned':
      return 'var(--color-status-assigned)';
    case 'in_progress':
      return 'var(--color-status-in-progress)';
    case 'review':
      return 'var(--color-status-review)';
    case 'completed':
      return 'var(--color-status-completed)';
    case 'disputed':
      return 'var(--color-status-disputed)';
    case 'cancelled':
    case 'expired':
      return 'var(--color-status-cancelled)';
    case 'failed':
      return 'var(--color-status-failed)';
    case 'accepted':
      return 'var(--color-status-open)';
    case 'pending':
      return 'var(--color-status-bidding)';
    case 'rejected':
    case 'withdrawn':
      return 'var(--color-status-cancelled)';
    default:
      return 'var(--color-text-muted)';
  }
}

export const trustLabels: Record<number, string> = {
  0: 'Unverified',
  1: 'Email Verified',
  2: 'Challenge Passed',
  3: 'Portfolio Verified',
  4: 'Community Endorsed',
};
