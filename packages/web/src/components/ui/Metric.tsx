export function Metric({
  label,
  value,
  subvalue,
  className = '',
}: {
  label: string;
  value: string;
  subvalue?: string;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 ${className}`}>
      <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="mt-2 text-sm leading-7 text-[var(--color-text)]">{value}</p>
      {subvalue && (
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{subvalue}</p>
      )}
    </div>
  );
}
