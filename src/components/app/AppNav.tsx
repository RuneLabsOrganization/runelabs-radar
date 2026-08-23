'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { paths } from '@/lib/urls';
import { cn } from '@/lib/utils';

const WORKSPACES = [
  { href: paths.signal, label: 'Signal', match: (p: string) => p === '/app' || p.startsWith('/app/brief') || p.startsWith('/app/map') || p.startsWith('/app/domain') || p.startsWith('/app/search') || p.startsWith('/app/story') || p.startsWith('/app/entity') },
  { href: paths.decide, label: 'Decide', match: (p: string) => p.startsWith('/app/decide') },
  { href: paths.build, label: 'Build', match: (p: string) => p.startsWith('/app/build') },
  { href: paths.connect, label: 'Connect', match: (p: string) => p.startsWith('/app/connect') },
] as const;

export function AppNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="mono flex h-12 items-center gap-1 text-[11px] tracking-[0.1em] uppercase">
      {WORKSPACES.map((w) => {
        const active = w.match(pathname);
        return (
          <Link
            key={w.href}
            href={w.href}
            className={cn(
              'flex h-full items-center border-b-2 px-2.5 transition-colors',
              active ? 'border-phosphor text-ink' : 'border-transparent text-ink-3 hover:text-ink-2',
            )}
          >
            {w.label}
          </Link>
        );
      })}
      {isAdmin && (
        <Link
          href={paths.admin}
          className={cn(
            'flex h-full items-center border-b-2 px-2.5 transition-colors',
            pathname.startsWith('/app/admin') ? 'border-phosphor text-ink' : 'border-transparent text-ink-3 hover:text-ink-2',
          )}
        >
          Admin
        </Link>
      )}
    </nav>
  );
}

export { WORKSPACES };
