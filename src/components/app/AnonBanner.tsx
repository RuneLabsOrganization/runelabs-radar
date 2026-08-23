'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { paths } from '@/lib/urls';

const KEY = 'radar_anon_banner_dismissed';

/**
 * Answers the question the header cannot: reading is free and needs no
 * account, so "Sign in" is only about generative work. Dismissible, because
 * returning anonymous readers should not be nagged forever.
 */
export function AnonBanner() {
  const pathname = usePathname();
  const [hidden, setHidden] = React.useState(true);

  React.useEffect(() => {
    try {
      setHidden(localStorage.getItem(KEY) === '1');
    } catch {
      setHidden(false); // storage blocked — show it
    }
  }, []);

  if (hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // non-fatal: it reappears next visit
    }
  };

  return (
    <div className="border-b border-grat bg-phosphor-dim">
      <div className="mx-auto flex max-w-[1200px] items-center gap-3 px-4 py-1.5 sm:px-6">
        <p className="text-[12.5px] text-ink-2">
          <span className="text-ink">Free to read.</span>
          <span className="hidden sm:inline"> Sign in only when you want to run debates, plans, and batches.</span>
          <span className="sm:hidden"> Sign in to run debates and plans.</span>
        </p>
        <Link
          href={`${paths.login}?next=${encodeURIComponent(pathname)}`}
          className="mono ml-auto shrink-0 text-[10.5px] uppercase tracking-[0.1em] text-phosphor hover:underline"
        >
          Sign in
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 text-ink-4 transition-colors hover:text-ink-2"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
