'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeWorkspace, tabActive } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * Section tabs for the active workspace, derived from the URL.
 *
 * This used to be pasted into eighteen page files, which meant Connect,
 * Account and Admin had no tabs at all and the labels had drifted. Rendering
 * it once in the layout keeps the chrome identical on every route.
 */
export function AppSubNav() {
  const pathname = usePathname();
  const workspace = activeWorkspace(pathname);
  if (!workspace || workspace.tabs.length === 0) return null;

  return (
    <nav aria-label={`${workspace.label} sections`} className="scroll-x border-t border-grat-soft">
      <ul className="mono mx-auto flex max-w-[1200px] items-center gap-1 px-4 text-[10.5px] uppercase tracking-[0.1em] sm:px-6">
        {workspace.tabs.map((tab) => {
          const active = tabActive(tab, pathname);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-9 items-center whitespace-nowrap border-b-2 px-2.5 transition-colors',
                  active ? 'border-phosphor text-ink' : 'border-transparent text-ink-4 hover:text-ink-2',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
