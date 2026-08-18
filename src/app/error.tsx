'use client';

import Link from 'next/link';

/** Page-level error boundary for every hub segment (root layout stays interactive). */
export default function Error({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-[480px] flex-col items-start justify-center px-6 py-16">
      <span aria-hidden className="inline-block h-[14px] w-[3px]" style={{ background: 'var(--alert)' }} />
      <h1 className="mt-4 text-[21px] font-semibold tracking-[-0.01em]">Something failed on our end</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
        The page hit an unexpected error. Try again — if it persists, it&rsquo;s on us, not you.
      </p>
      <div className="mt-6 flex gap-2">
        <button type="button" onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <Link href="/" className="btn">
          Back to today
        </Link>
      </div>
    </div>
  );
}
