import Link from 'next/link';

type Variant = 'primary' | 'secondary' | 'ghost';

const styles: Record<Variant, string> = {
  primary: 'bg-[#00FF88] text-[#0A0A0A] font-medium hover:brightness-110',
  secondary: 'border border-[#333] text-[#E0E0E0] hover:border-[#00FF88] hover:text-[#00FF88]',
  ghost: 'text-[#888] hover:text-[#00FF88]',
};

type Props = {
  variant?: Variant;
  href?: string;
  external?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'>;

export function Button({ variant = 'primary', href, external, className = '', children, ...rest }: Props) {
  const base = `inline-flex items-center justify-center px-4 py-2 text-sm transition-all duration-150 ${styles[variant]} ${className}`;

  if (href && external) return <a href={href} target="_blank" rel="noreferrer" className={base}>{children}</a>;
  if (href) return <Link href={href} className={base}>{children}</Link>;
  return <button className={base} {...rest}>{children}</button>;
}
