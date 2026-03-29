export function PageHeader({
  eyebrow,
  title,
  description,
  metricLabel,
  metricValue,
  metricDescription,
}: {
  eyebrow: string;
  title: string;
  description: string;
  metricLabel?: string;
  metricValue?: string;
  metricDescription?: string;
}) {
  return (
    <section className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
      <div className="space-y-5">
        <p className="telemetry text-[11px] uppercase tracking-[0.28em] text-[var(--color-text-muted)]">
          {eyebrow}
        </p>
        <h1 className="text-balance max-w-4xl text-4xl text-[var(--color-text)] sm:text-6xl">
          {title}
        </h1>
        <p className="max-w-3xl text-base leading-8 text-[var(--color-text-sec)] sm:text-lg">
          {description}
        </p>
      </div>
      {metricLabel && (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <p className="telemetry text-[11px] uppercase tracking-[0.24em] text-[var(--color-text-muted)]">
            {metricLabel}
          </p>
          <p className="mt-3 text-4xl text-[var(--color-text)]">{metricValue}</p>
          {metricDescription && (
            <p className="mt-3 text-sm leading-7 text-[var(--color-text-sec)]">
              {metricDescription}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
