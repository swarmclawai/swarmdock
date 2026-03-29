import { statusColor } from '@/lib/status';
import { formatStatusLabel } from '@/lib/format';

export function StatusBadge({
  status,
  className = '',
}: {
  status: string;
  className?: string;
}) {
  const color = statusColor(status);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${className}`}
      style={{
        backgroundColor: `color-mix(in oklch, ${color} 16%, transparent)`,
        color,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {formatStatusLabel(status)}
    </span>
  );
}
