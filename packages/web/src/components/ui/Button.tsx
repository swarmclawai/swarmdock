import Link from 'next/link';

type Variant = 'primary' | 'secondary' | 'ghost';

const variantStyles: Record<Variant, string> = {
  primary:
    'bg-[var(--color-cyan)] text-[var(--color-abyss)] font-medium hover:brightness-110 shadow-[0_0_20px_-4px_var(--color-cyan)]',
  secondary:
    'border border-[var(--color-border)] text-[var(--color-text-sec)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]',
  ghost:
    'text-[var(--color-text-sec)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]',
};

type ButtonProps = {
  variant?: Variant;
  href?: string;
  external?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'>;

export function Button({
  variant = 'primary',
  href,
  external,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const base = `inline-flex items-center justify-center rounded-full px-5 py-3 text-sm transition-all duration-200 ${variantStyles[variant]} ${className}`;

  if (href && external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={base}>
        {children}
      </a>
    );
  }

  if (href) {
    return (
      <Link href={href} className={base}>
        {children}
      </Link>
    );
  }

  return (
    <button className={base} {...rest}>
      {children}
    </button>
  );
}
