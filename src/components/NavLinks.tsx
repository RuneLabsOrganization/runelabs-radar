'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavLinkItem {
  href: string;
  label: string;
  active: boolean;
}

export function buildLinks(pathname: string, isAdmin: boolean): NavLinkItem[] {
  return [
    { href: '/', label: 'Today', active: pathname === '/' || pathname.startsWith('/domain') },
    { href: '/opportunities', label: 'Opportunities', active: pathname.startsWith('/opportunities') },
    { href: '/map', label: 'Topic Map', active: pathname.startsWith('/map') },
    { href: '/board', label: 'Best Tools', active: pathname.startsWith('/board') },
    { href: '/stacks', label: 'Stacks', active: pathname.startsWith('/stacks') },
    { href: '/brief', label: 'Brief', active: pathname.startsWith('/brief') },
    { href: '/connect', label: 'Connect', active: pathname.startsWith('/connect') },
    { href: '/pricing', label: 'Pricing', active: pathname.startsWith('/pricing') },
    { href: '/changelog', label: 'Changelog', active: pathname.startsWith('/changelog') },
    { href: '/accuracy', label: 'Accuracy', active: pathname.startsWith('/accuracy') },
    ...(isAdmin ? [{ href: '/admin', label: 'Admin', active: pathname.startsWith('/admin') }] : []),
  ];
}

/** Desktop bar: the daily-habit pages inline; the rest behind "more". */
const PRIMARY = ['/', '/brief', '/board', '/opportunities'];

const linkCls = (active: boolean) =>
  `flex h-full shrink-0 items-center whitespace-nowrap border-b-2 transition-colors ${
    active
      ? 'border-[var(--phosphor)] text-[var(--ink)]'
      : 'border-transparent text-[var(--ink-3)] hover:text-[var(--ink-2)]'
  }`;

export default function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const links = buildLinks(pathname, isAdmin);
  const primary = links.filter((l) => PRIMARY.includes(l.href));
  const secondary = links.filter((l) => !PRIMARY.includes(l.href));
  const moreActive = secondary.some((l) => l.active);

  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  // close on navigation
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // close on Escape / outside click
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <nav className="mono flex h-12 items-center gap-4 text-[11px] tracking-[0.1em] uppercase">
      {primary.map((l) => (
        <Link key={l.href} href={l.href} className={linkCls(l.active)}>
          {l.label}
        </Link>
      ))}
      <div ref={wrapRef} className="relative flex h-full items-center">
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((o) => !o)}
          className={`mono ${linkCls(moreActive)} cursor-pointer bg-transparent p-0 text-[11px] tracking-[0.1em] uppercase`}
        >
          more {open ? '▴' : '▾'}
        </button>
        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full z-30 mt-px min-w-[140px] rounded-[4px] border border-[var(--grat)] bg-[var(--scope-2)] py-1"
          >
            {secondary.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                role="menuitem"
                className={`block whitespace-nowrap px-3.5 py-2 text-[10.5px] ${
                  l.active ? 'text-[var(--phosphor)]' : 'text-[var(--ink-2)] hover:text-[var(--ink)]'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
