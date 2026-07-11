'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const links = [
    { href: '/', label: 'Briefing', active: pathname === '/' || pathname.startsWith('/domain') },
    { href: '/board', label: 'Board', active: pathname.startsWith('/board') },
    { href: '/stacks', label: 'Stacks', active: pathname.startsWith('/stacks') },
    { href: '/brief', label: 'Brief', active: pathname.startsWith('/brief') },
    ...(isAdmin ? [{ href: '/admin', label: 'Admin', active: pathname.startsWith('/admin') }] : []),
  ];
  return (
    <nav className="mono flex h-12 items-center gap-5 text-[11px] tracking-[0.1em] uppercase">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`flex h-full items-center border-b-2 transition-colors ${
            l.active
              ? 'border-[var(--phosphor)] text-[var(--ink)]'
              : 'border-transparent text-[var(--ink-3)] hover:text-[var(--ink-2)]'
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
