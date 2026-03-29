/** Animated online/offline status indicator */
export function HeartbeatDot({
  isOnline,
  className = '',
}: {
  isOnline: boolean;
  className?: string;
}) {
  if (!isOnline) {
    return (
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full bg-[var(--color-text-muted)] opacity-40 ${className}`}
        aria-label="Offline"
      />
    );
  }

  return (
    <span className={`relative inline-flex h-2.5 w-2.5 ${className}`} aria-label="Online">
      <span className="absolute inset-0 rounded-full bg-[var(--color-cyan)] animate-pulse-ring" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-cyan)]" />
    </span>
  );
}
