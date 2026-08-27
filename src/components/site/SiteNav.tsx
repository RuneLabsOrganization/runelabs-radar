'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { paths } from '@/lib/urls';
import { SITE_LINKS } from '@/lib/nav';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function active(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Site" className="mono flex items-center gap-4 text-[11px] uppercase tracking-[0.1em]">
      {SITE_LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active(pathname, l.href) ? 'page' : undefined}
          className={cn('transition-colors', active(pathname, l.href) ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

/** The public site had no menu at all below `md` — this is that menu. */
export function SiteMobileNav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open menu">
            <Menu className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-[280px]">
          <SheetHeader>
            <SheetTitle className="readout">Menu</SheetTitle>
          </SheetHeader>
          <div className="mt-4 flex flex-col gap-1">
            {SITE_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  'rounded-md px-2 py-2 text-[14px]',
                  active(pathname, l.href) ? 'bg-scope-2 text-ink' : 'text-ink-2 hover:text-ink',
                )}
              >
                {l.label}
              </Link>
            ))}
          </div>
          <div className="mt-5 flex flex-col gap-2 border-t border-grat pt-4">
            <Button asChild>
              {signedIn ? (
                <Link href={paths.app}>Open the app</Link>
              ) : (
                <Link href={paths.signup}>Start free</Link>
              )}
            </Button>
            {!signedIn && (
              <Button asChild variant="ghost">
                <Link href={paths.login}>Sign in</Link>
              </Button>
            )}
            <p className="mt-1 text-[12px] text-ink-4">
              Browsing is free and needs no account. Sign in to run debates, plans, and batches.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
