'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { paths } from '@/lib/urls';
import { cn } from '@/lib/utils';

const DECIDE_TABS = [
  { href: paths.tools, label: 'Tools' },
  { href: paths.stacks, label: 'Stacks' },
  { href: paths.agents, label: 'Agents' },
  { href: paths.metrics, label: 'Metrics' },
] as const;

const BUILD_TABS = [
  { href: paths.opportunities, label: 'Opportunities' },
  { href: paths.batches, label: 'Batches' },
  { href: paths.debates, label: 'Debates' },
] as const;

const SIGNAL_TABS = [
  { href: paths.signal, label: 'Today' },
  { href: paths.brief, label: 'Brief' },
  { href: paths.map, label: 'Map' },
  { href: paths.search, label: 'Search' },
] as const;

function signalTabActive(pathname: string, href: string): boolean {
  if (href === paths.signal) {
    return (
      pathname === paths.signal ||
      pathname.startsWith('/app/domain/') ||
      pathname.startsWith('/app/story/') ||
      pathname.startsWith('/app/entity/')
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function WorkspaceNav({ section }: { section: 'signal' | 'decide' | 'build' }) {
  const pathname = usePathname();
  const tabs =
    section === 'signal' ? SIGNAL_TABS : section === 'decide' ? DECIDE_TABS : BUILD_TABS;
  const ariaLabel =
    section === 'signal' ? 'Signal sections' : section === 'decide' ? 'Decide sections' : 'Build sections';

  return (
    <nav
      className="mb-5 flex flex-wrap gap-1 border-b border-grat-soft pb-0"
      aria-label={ariaLabel}
    >
      {tabs.map((t) => {
        const active =
          section === 'signal' ? signalTabActive(pathname, t.href) : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              'mono -mb-px border-b-2 px-2.5 py-2 text-[10.5px] uppercase tracking-[0.1em] transition-colors',
              active
                ? 'border-phosphor text-ink'
                : 'border-transparent text-ink-3 hover:text-ink-2',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
