import Link from 'next/link';

type Variant = 'primary' | 'secondary' | 'ghost';

const styles: Record<Variant, string> = {
  primary: 'bg-[var(--color-accent)] text-white font-medium hover:brightness-110',
  secondary: 'border border-[var(--color-border-hard)] text-[var(--color-text-2)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]',
  ghost: 'text-[var(--color-text-2)] hover:text-[var(--color-text)]',
};

type Props = {
  variant?: Variant;
  href?: string;
  external?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'>;

export function Button({ variant = 'primary', href, external, className = '', children, ...rest }: Props) {
  const base = `inline-flex items-center justify-center rounded-md px-4 py-2 text-sm transition-all duration-150 ${styles[variant]} ${className}`;

  if (href && external) return <a href={href} target="_blank" rel="noreferrer" className={base}>{children}</a>;
  if (href) return <Link href={href} className={base}>{children}</Link>;
  return <button className={base} {...rest}>{children}</button>;
}
