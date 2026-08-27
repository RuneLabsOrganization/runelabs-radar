import Link from 'next/link';
import { requireViewer } from '@/lib/auth/user';
import { chromeStatus } from '@/lib/jobs-status';
import { timeAgo } from '@/lib/feed';
import { paths } from '@/lib/urls';
import { SITE_LINKS } from '@/lib/nav';
import AnonFresh from '@/components/AnonFresh';
import FeedKeys from '@/components/FeedKeys';
import RadarBackdrop from '@/components/RadarBackdrop';
import ThemeToggle from '@/components/ThemeToggle';
import { Logo } from '@/components/brand/Logo';
import { AppNav } from '@/components/app/AppNav';
import { AppSubNav } from '@/components/app/AppSubNav';
import { AppMobileNav } from '@/components/app/AppMobileNav';
import { AnonBanner } from '@/components/app/AnonBanner';
import { HeaderOffset } from '@/components/app/HeaderOffset';
import { CommandPalette } from '@/components/app/CommandPalette';
import { UserMenu } from '@/components/app/UserMenu';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireViewer();
  const isAdmin = user?.role === 'admin';
  const { lastSweep, ingestStale, curateStale } = chromeStatus();
  const stale = ingestStale || curateStale;
  const sweepTitle = stale
    ? [
        ...(ingestStale ? ['ingest has not succeeded in over 2h'] : []),
        ...(curateStale ? ['curation has not succeeded in over 3h'] : []),
      ].join('; ')
    : 'all scans nominal';

  return (
    <div className="flex min-h-screen flex-col">
      <div aria-hidden className="fixed inset-0 -z-10">
        <RadarBackdrop intensity={0.05} fps={20} />
      </div>

      <header id="app-header" className="sticky top-0 z-20 border-b border-grat bg-[var(--header-bg)] backdrop-blur">
        {/*
          One switcher that reflows: it sits inline on wide screens and wraps
          onto its own full-width line below `md`, rather than being rendered
          twice or hidden behind a menu.
        */}
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-2 px-4 sm:gap-x-3 sm:px-6">
          {/* The logo is the way out of the app, in both shells, always. */}
          <div className="flex h-12 shrink-0 items-center gap-2 sm:gap-3">
            <Logo href={paths.home} size="md" />
            {/* Mode marker: says the header you are looking at is the product, not the site. */}
            <span className="mono hidden rounded-sm border border-grat px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.12em] text-ink-4 sm:inline-block">
              Workspace
            </span>
          </div>

          <div className="order-last w-full border-t border-grat-soft md:order-none md:w-auto md:min-w-0 md:flex-1 md:border-t-0">
            <AppNav isAdmin={isAdmin} />
          </div>

          <div className="ml-auto flex h-12 shrink-0 items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <CommandPalette />
            <span
              className="mono hidden items-center gap-1.5 text-[10.5px] uppercase tracking-[0.08em] lg:flex"
              style={{ color: stale ? 'var(--amber)' : 'var(--ink-4)' }}
              title={sweepTitle}
            >
              <span
                aria-hidden
                className="inline-block h-[6px] w-[6px] rounded-full"
                style={{ background: stale ? 'var(--amber)' : 'var(--phosphor)' }}
              />
              scanned {lastSweep ? timeAgo(lastSweep) : '—'}
            </span>
            <UserMenu userName={user?.name ?? null} />
            <div className="md:hidden">
              <AppMobileNav
                isAdmin={isAdmin}
                userName={user?.name ?? null}
                sweepLabel={lastSweep ? timeAgo(lastSweep) : '—'}
                sweepStale={stale}
                sweepTitle={sweepTitle}
              />
            </div>
          </div>
        </div>

        <AppSubNav />
      </header>
      <HeaderOffset targetId="app-header" />

      {!user && <AnonBanner />}

      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6">{children}</main>

      <footer className="mt-12 border-t border-grat">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-5 sm:px-6">
          <Link href={paths.home} className="mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2">
            ← Back to site
          </Link>
          <div className="mono flex flex-wrap gap-x-5 gap-y-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-4">
            {SITE_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-ink-2">
                {l.label}
              </Link>
            ))}
            <Link href={paths.privacy} className="hover:text-ink-2">
              Privacy
            </Link>
            <Link href={paths.terms} className="hover:text-ink-2">
              Terms
            </Link>
            <a href="mailto:hello@runelabs.org" className="hover:text-ink-2 normal-case tracking-normal">
              hello@runelabs.org
            </a>
          </div>
        </div>
      </footer>

      <AnonFresh enabled={!user} />
      <FeedKeys />
    </div>
  );
}
