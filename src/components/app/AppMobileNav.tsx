'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { paths } from '@/lib/urls';
import { SITE_LINKS, tabActive, workspacesFor } from '@/lib/nav';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import ThemeToggle from '@/components/ThemeToggle';
import LogoutButton from '@/components/LogoutButton';
import { cn } from '@/lib/utils';

/**
 * Secondary menu. The workspace switcher and its tabs are always on screen
 * now, so this carries the things that have nowhere else to live: deep links
 * into each workspace, the public site, scan status and the account controls.
 */
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
          {workspacesFor(isAdmin).map((w) => (
            <div key={w.id}>
              <Link href={w.href} className="readout text-phosphor">
                {w.label}
              </Link>
              <p className="mt-0.5 text-[12px] text-ink-4">{w.hint}</p>
              {w.tabs.length > 0 && (
                <div className="mt-1.5 flex flex-col gap-0.5">
                  {w.tabs.map((t) => (
                    <Link
                      key={t.href}
                      href={t.href}
                      className={cn(
                        'rounded-md px-2 py-1.5 text-[13px]',
                        tabActive(t, pathname) ? 'bg-scope-2 text-ink' : 'text-ink-2 hover:text-ink',
                      )}
                    >
                      {t.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}

          <div className="border-t border-grat pt-3">
            <div className="readout">Site</div>
            <div className="mt-1.5 flex flex-col gap-0.5">
              <Link href={paths.home} className="rounded-md px-2 py-1.5 text-[13px] text-ink-2 hover:text-ink">
                Home
              </Link>
              {SITE_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="rounded-md px-2 py-1.5 text-[13px] text-ink-2 hover:text-ink"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="border-t border-grat pt-3">
            <div
              className="mono flex items-center gap-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-4"
              title={sweepTitle}
            >
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
                  <Link href={paths.account} className="mono text-[11px] text-ink-3 hover:text-ink-2">
                    {userName}
                  </Link>
                  <LogoutButton />
                </>
              ) : (
                <Link
                  href={`${paths.login}?next=${encodeURIComponent(pathname)}`}
                  className="text-[12.5px] text-ink-2"
                >
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
