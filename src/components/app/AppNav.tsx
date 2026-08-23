'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { workspacesFor } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * Primary workspace switcher. Always visible at every width — it scrolls
 * horizontally rather than collapsing into a menu, because hiding the only
 * way between workspaces behind a hamburger is what made the app feel lost.
 */
export function AppNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspaces" className="scroll-x">
      <ul className="mono flex items-center gap-1 text-[11px] uppercase tracking-[0.1em]">
        {workspacesFor(isAdmin).map((w) => {
          const active = w.match(pathname);
          return (
            <li key={w.id}>
              <Link
                href={w.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-12 items-center whitespace-nowrap border-b-2 px-2.5 transition-colors',
                  active ? 'border-phosphor text-ink' : 'border-transparent text-ink-3 hover:text-ink-2',
                )}
              >
                {w.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
