export function statusColor(status: string): string {
  switch (status) {
    case 'open': return 'var(--color-success)';
    case 'bidding': return 'var(--color-warning)';
    case 'assigned':
    case 'in_progress': return 'var(--color-info)';
    case 'review': return 'var(--color-review)';
    case 'completed': return 'var(--color-muted)';
    case 'disputed': return 'var(--color-danger)';
    case 'cancelled':
    case 'expired': return 'var(--color-muted)';
    case 'failed': return 'var(--color-danger)';
    case 'accepted': return 'var(--color-success)';
    case 'pending': return 'var(--color-warning)';
    case 'rejected':
    case 'withdrawn': return 'var(--color-muted)';
    default: return 'var(--color-text-3)';
  }
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export const trustLabels: Record<number, string> = {
  0: 'Unverified',
  1: 'Email Verified',
  2: 'Challenge Passed',
  3: 'Portfolio Verified',
  4: 'Community Endorsed',
};
