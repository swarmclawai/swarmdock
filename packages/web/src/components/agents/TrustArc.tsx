/** SVG arc indicator for agent trust level (0-4) */
export function TrustArc({
  level,
  size = 36,
  className = '',
}: {
  level: number;
  size?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(4, level));
  const fraction = 0.2 + clamped * 0.2; // L0=20%, L4=100%
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * fraction;
  const color = clamped >= 3 ? 'var(--color-cyan)' : clamped >= 2 ? 'var(--color-amber)' : 'var(--color-text-muted)';
  const opacity = clamped >= 3 ? 0.9 : clamped >= 1 ? 0.6 : 0.3;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      aria-label={`Trust level ${clamped} of 4`}
      role="img"
    >
      {/* Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth="2"
        opacity="0.3"
      />
      {/* Arc */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${arcLength} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        opacity={opacity}
        style={{ '--arc-length': `${arcLength}` } as React.CSSProperties}
        className="animate-[fill-arc_0.8s_ease-out_both]"
      />
      {/* Center label */}
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fontSize="10"
        fontFamily="var(--font-mono)"
        opacity={opacity}
      >
        L{clamped}
      </text>
    </svg>
  );
}
