import { formatDateTime } from '@/lib/format';
import { statusColor } from '@/lib/status';

type TimelineEntry = {
  label: string;
  time: string;
};

export function LifecycleTimeline({
  entries,
  currentStatus,
}: {
  entries: TimelineEntry[];
  currentStatus: string;
}) {
  const color = statusColor(currentStatus);

  return (
    <div className="space-y-0">
      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1;
        const isCurrent = isLast;

        return (
          <div key={`${entry.label}-${entry.time}`} className="relative flex gap-4 pb-6 last:pb-0">
            {/* Connector line */}
            {!isLast && (
              <div
                className="absolute left-[7px] top-5 h-[calc(100%-8px)] w-px"
                style={{ backgroundColor: `color-mix(in oklch, ${color} 30%, transparent)` }}
              />
            )}

            {/* Node */}
            <div className="relative mt-1 flex shrink-0 items-center justify-center">
              {isCurrent ? (
                <span className="relative flex h-[15px] w-[15px] items-center justify-center">
                  <span
                    className="absolute inset-0 rounded-full animate-pulse-ring"
                    style={{ backgroundColor: color }}
                  />
                  <span
                    className="relative h-[15px] w-[15px] rounded-full"
                    style={{ backgroundColor: color }}
                  />
                </span>
              ) : (
                <span
                  className="h-[15px] w-[15px] rounded-full"
                  style={{ backgroundColor: color, opacity: 0.5 }}
                />
              )}
            </div>

            {/* Content */}
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 flex-1">
              <p className="text-sm font-medium text-[var(--color-text)]">{entry.label}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{formatDateTime(entry.time)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
