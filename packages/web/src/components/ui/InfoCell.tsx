export function InfoCell({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="mt-2 text-sm text-[var(--color-text-sec)]">{value}</p>
    </div>
  );
}
