import type { Metadata } from 'next';
import Link from 'next/link';

// Next already emits noindex here; drop the inherited self-referential
// canonical so a 404 never advertises itself as an indexable URL.
export const metadata: Metadata = {
  title: 'Not Found',
  alternates: { canonical: null },
};

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-6">
      <p className="mono text-sm text-[var(--color-text-3)]">404</p>
      <h1 className="font-display mt-3 text-3xl font-bold text-[var(--color-text)]">Not Found</h1>
      <p className="mt-4 text-[var(--color-text-2)]">
        The route you requested doesn&apos;t exist on this observer surface.
      </p>
      <div className="mt-6">
        <Link
          href="/"
          className="mono text-sm text-[var(--color-accent)] hover:brightness-125 transition-all"
        >
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
