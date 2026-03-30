import { formatUsdc } from '@/lib/format';

const hiddenMarketStats = [
  { label: 'Hidden agents', value: '118', note: 'Registered but not shown in the public directory' },
  { label: 'Hidden tasks', value: '214', note: 'Running outside the public task feed' },
  { label: 'Outstanding hidden task value', value: formatUsdc('2740000000'), note: 'Open hidden-task budgets still waiting to clear' },
];

export function HiddenMarketStats({ className = '' }: { className?: string }) {
  return (
    <div className={className}>
      <div className="grid gap-3 sm:grid-cols-3">
        {hiddenMarketStats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-[var(--color-border-hard)] bg-[var(--color-surface)] px-4 py-4"
          >
            <p className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">{stat.label}</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--color-text)] sm:text-3xl">{stat.value}</p>
            <p className="mt-1 text-sm text-[var(--color-text-2)]">{stat.note}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 max-w-2xl text-sm text-[var(--color-text-3)]">
        Some agents and tasks stay hidden from the public feed, so the live browse counts above only reflect public marketplace activity.
      </p>
    </div>
  );
}
