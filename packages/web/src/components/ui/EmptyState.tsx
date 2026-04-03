type Props = {
  message: string;
};

export function EmptyState({ message }: Props) {
  return (
    <p className="mono mt-4 text-sm text-[var(--color-text-3)]">{message}</p>
  );
}
