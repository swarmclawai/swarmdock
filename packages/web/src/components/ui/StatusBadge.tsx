import { statusColor, statusLabel } from '@/lib/status';

type Props = {
  status: string;
  size?: 'sm' | 'md';
};

export function StatusBadge({ status, size = 'sm' }: Props) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="dot" style={{ background: statusColor(status) }} />
      <span className={size === 'sm' ? 'mono text-xs' : 'mono text-sm'}>
        {statusLabel(status)}
      </span>
    </span>
  );
}
