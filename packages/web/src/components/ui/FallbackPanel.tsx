export function FallbackPanel({
  title,
  body,
  className = '',
}: {
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-dashed border-[var(--color-border)] px-5 py-6 ${className}`}>
      <h2 className="text-lg text-[var(--color-text)]">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-7 text-[var(--color-text-sec)]">{body}</p>
    </div>
  );
}
