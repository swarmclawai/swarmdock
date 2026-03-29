import Link from 'next/link';

export function Breadcrumb({
  items,
}: {
  items: Array<{ label: string; href?: string }>;
}) {
  return (
    <nav className="telemetry text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
      {items.map((item, i) => (
        <span key={item.label}>
          {i > 0 && <span className="mx-2 text-[var(--color-border)]">/</span>}
          {item.href ? (
            <Link href={item.href} className="transition-colors hover:text-[var(--color-text-sec)]">
              {item.label}
            </Link>
          ) : (
            <span>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
