'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { paths } from '@/lib/urls';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import ThemeToggle from '@/components/ThemeToggle';
import LogoutButton from '@/components/LogoutButton';
import { WORKSPACES } from './AppNav';

const SUBLINKS: Record<string, { href: string; label: string }[]> = {
  [paths.signal]: [
    { href: paths.signal, label: 'Today' },
    { href: paths.brief, label: 'Brief' },
    { href: paths.map, label: 'Topic Map' },
    { href: paths.search, label: 'Search' },
  ],
  [paths.decide]: [
    { href: paths.tools, label: 'Best Tools' },
    { href: paths.stacks, label: 'Stacks' },
    { href: paths.agents, label: 'Agents' },
    { href: paths.metrics, label: 'Metrics' },
  ],
  [paths.build]: [
    { href: paths.opportunities, label: 'Opportunities' },
    { href: paths.batches, label: 'Batches' },
    { href: paths.debates, label: 'Debates' },
  ],
  [paths.connect]: [{ href: paths.connect, label: 'Install MCP' }],
};

export function AppMobileNav({
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

  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open menu">
            <Menu className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-[300px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="readout">Navigate</SheetTitle>
          </SheetHeader>
          <div className="mt-4 flex flex-col gap-4">
            {WORKSPACES.map((w) => (
              <div key={w.href}>
                <Link href={w.href} className="readout text-phosphor">
                  {w.label}
                </Link>
                <div className="mt-1.5 flex flex-col gap-0.5">
                  {(SUBLINKS[w.href] ?? []).map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      className={`rounded-md px-2 py-1.5 text-[13px] ${
                        pathname === l.href ? 'bg-scope-2 text-ink' : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            {isAdmin && (
              <Link href={paths.admin} className="text-[13px] text-ink-2">
                Admin
              </Link>
            )}
            <div className="border-t border-grat pt-3">
              <div className="mono flex items-center gap-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-4" title={sweepTitle}>
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: sweepStale ? 'var(--amber)' : 'var(--phosphor)' }}
                />
                scanned {sweepLabel}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <ThemeToggle />
                {userName ? (
                  <>
                    <span className="mono text-[11px] text-ink-3">{userName}</span>
                    <LogoutButton />
                  </>
                ) : (
                  <Link href={paths.login} className="text-[12.5px] text-ink-2">
                    Sign in
                  </Link>
                )}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
