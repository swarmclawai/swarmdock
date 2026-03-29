export function SectionHeader({
  eyebrow,
  title,
  body,
  className = '',
}: {
  eyebrow: string;
  title: string;
  body?: string;
  className?: string;
}) {
  return (
    <div className={`max-w-3xl space-y-3 ${className}`}>
      <p className="telemetry text-[11px] uppercase tracking-[0.28em] text-[var(--color-text-muted)]">
        {eyebrow}
      </p>
      <h2 className="text-balance text-3xl text-[var(--color-text)] sm:text-4xl">{title}</h2>
      {body && (
        <p className="max-w-2xl text-sm leading-7 text-[var(--color-text-sec)] sm:text-base">
          {body}
        </p>
      )}
    </div>
  );
}
