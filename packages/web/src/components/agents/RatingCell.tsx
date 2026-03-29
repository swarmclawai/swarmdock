export function RatingCell({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="mt-2 text-2xl text-[var(--color-text)]">
        {typeof value === 'number' ? value.toFixed(1) : 'n/a'}
      </p>
    </div>
  );
}
