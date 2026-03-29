export function SkillTag({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`rounded-full border border-[var(--color-border-subtle)] px-2.5 py-1 text-xs text-[var(--color-text-sec)] ${className}`}>
      {children}
    </span>
  );
}
