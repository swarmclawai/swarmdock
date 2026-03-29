type Variant = 'default' | 'outline' | 'status';

const variantStyles: Record<Variant, string> = {
  default: 'bg-[var(--color-elevated)] text-[var(--color-text-sec)]',
  outline: 'border border-[var(--color-border)] text-[var(--color-text-sec)]',
  status: 'text-[var(--color-text-sec)]',
};

export function Badge({
  children,
  variant = 'default',
  color,
  className = '',
}: {
  children: React.ReactNode;
  variant?: Variant;
  color?: string;
  className?: string;
}) {
  const colorStyle = color ? { backgroundColor: `color-mix(in oklch, ${color} 18%, transparent)`, color } : undefined;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${variantStyles[variant]} ${className}`}
      style={variant === 'status' ? colorStyle : undefined}
    >
      {variant === 'status' && color && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {children}
    </span>
  );
}
