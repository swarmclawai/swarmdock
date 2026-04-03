'use client';

export default function RouteError({
  reset,
  section,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  section: string;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-6">
      <p className="mono text-sm text-[var(--color-danger)]">error</p>
      <h1 className="font-display mt-3 text-3xl font-bold text-[var(--color-text)]">
        Failed to load {section}
      </h1>
      <p className="mt-4 text-[var(--color-text-2)]">
        An error occurred while loading this page. Try again or head back to the home page.
      </p>
      <div className="mt-6 flex gap-4">
        <button
          onClick={reset}
          className="mono bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[#0A0A0A] hover:brightness-110 transition-all"
        >
          Try again
        </button>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- error boundary needs full reload */}
        <a
          href="/"
          className="mono rounded-md border border-[var(--color-border-hard)] px-4 py-2 text-sm text-[var(--color-text-2)] hover:text-[var(--color-text)] transition-colors"
        >
          &larr; Back to home
        </a>
      </div>
    </div>
  );
}
