import Link from 'next/link';

type CardProps = {
  href?: string;
  glow?: boolean;
  className?: string;
  children: React.ReactNode;
};

export function Card({ href, glow = false, className = '', children }: CardProps) {
  const base = `rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 transition-all duration-200 ${
    glow ? 'glow-surface' : ''
  } ${href ? 'group hover:border-[var(--color-cyan)]/40 hover:translate-y-[-1px]' : ''} ${className}`;

  if (href) {
    return (
      <Link href={href} className={`block ${base}`}>
        {children}
      </Link>
    );
  }

  return <div className={base}>{children}</div>;
}
