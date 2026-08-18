'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { buildLinks } from './NavLinks';
import LogoutButton from './LogoutButton';
import ThemeToggle from './ThemeToggle';

/**
 * Mobile navigation: 44px hamburger in the top bar, full-width drawer below it.
 * The desktop nav (NavLinks) is hidden < md; this carries links + sweep status
 * + session controls that would otherwise force the header past 390px.
 */
export default function MobileNav({
  isAdmin,
  userName,
  sweepLabel,
  sweepStale,
  sweepTitle,
}: {
  isAdmin: boolean;
  userName: string | null;
  sweepLabel: string;
  sweepStale: boolean;
  sweepTitle: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const links = buildLinks(pathname, isAdmin);

  // close on navigation
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // close on Escape
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="ml-auto flex items-center gap-2 lg:hidden">
      <ThemeToggle />
      <button
        type="button"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-[44px] w-[44px] items-center justify-center text-[var(--ink-3)] transition-colors hover:text-[var(--ink)]"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          {open ? (
            <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.5" />
          ) : (
            <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.5" />
          )}
        </svg>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 top-12 z-20 cursor-default bg-[var(--overlay-bg)]"
            onClick={() => setOpen(false)}
          />
          <nav className="mono fixed inset-x-0 top-12 z-30 border-b border-[var(--grat)] bg-[var(--scope-1)] px-6 py-2 text-[12px] tracking-[0.1em] uppercase">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`flex min-h-[44px] items-center border-b border-[var(--grat-soft)] last:border-b-0 ${
                  l.active ? 'text-[var(--phosphor)]' : 'text-[var(--ink-2)]'
                }`}
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/search"
              className="flex min-h-[44px] items-center border-b border-[var(--grat-soft)] text-[var(--ink-2)]"
            >
              Search
            </Link>
            <div
              className="flex min-h-[44px] items-center gap-1.5 border-b border-[var(--grat-soft)] text-[11px]"
              style={{ color: sweepStale ? 'var(--amber)' : 'var(--ink-4)' }}
              title={sweepTitle}
            >
              <span
                aria-hidden
                className="inline-block h-[6px] w-[6px] rounded-full"
                style={{ background: sweepStale ? 'var(--amber)' : 'var(--phosphor)' }}
              />
              scanned {sweepLabel}
            </div>
            <div className="flex min-h-[44px] items-center justify-between text-[11px]">
              {userName ? (
                <>
                  <span className="text-[var(--ink-3)]">{userName}</span>
                  <LogoutButton />
                </>
              ) : (
                <Link href="/login" className="text-[var(--ink-2)]">
                  sign in
                </Link>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
