import Link from 'next/link';
import { getIdentity } from '@/lib/identity';
import { paths } from '@/lib/urls';
import { SITE_LINKS } from '@/lib/nav';
import ThemeToggle from '@/components/ThemeToggle';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { SiteLinks, SiteMobileNav } from '@/components/site/SiteNav';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const name = getIdentity().productName;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-grat bg-[var(--header-bg)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1100px] items-center gap-4 px-4 sm:px-6">
          <Logo href={paths.home} size="md" />
          <div className="ml-4 hidden md:block">
            <SiteLinks />
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            {/* Sign in stays a quiet text link so the free entry point reads as the destination. */}
            <Link
              href={paths.login}
              className="mono hidden text-[10.5px] uppercase tracking-[0.1em] text-ink-3 transition-colors hover:text-ink-2 sm:inline"
            >
              Sign in
            </Link>
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link href={paths.app}>Open the app</Link>
            </Button>
            <SiteMobileNav />
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="mt-20 border-t border-grat">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div>
            <div className="mono text-[11px] font-semibold tracking-[0.16em]">{name.toUpperCase()}</div>
            <p className="mt-1 max-w-md text-[12.5px] text-ink-3">
              Intelligence for people building with AI — Radar researches so your coding agent does not.
            </p>
            <p className="mt-2 max-w-md text-[12px] text-ink-4">
              Compact reads are free. Sign in for ask_radar, debates, plans, and a token-savings receipt.
            </p>
          </div>
          <div className="mono flex flex-wrap gap-x-5 gap-y-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-4">
            <Link href={paths.app} className="text-ink-3 hover:text-ink-2">
              Open the app
            </Link>
            {SITE_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-ink-2">
                {l.label}
              </Link>
            ))}
            <a
              href="https://github.com/RuneLabsOrganization/runelabs-radar"
              className="hover:text-ink-2"
              rel="noreferrer"
            >
              Self-host
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
