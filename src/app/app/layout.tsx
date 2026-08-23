import { requireViewer } from '@/lib/auth/user';
import { getStaleness, lastOkAt } from '@/lib/jobs';
import { timeAgo } from '@/lib/feed';
import { paths } from '@/lib/urls';
import AnonFresh from '@/components/AnonFresh';
import FeedKeys from '@/components/FeedKeys';
import RadarBackdrop from '@/components/RadarBackdrop';
import ThemeToggle from '@/components/ThemeToggle';
import { Logo } from '@/components/brand/Logo';
import { AppNav } from '@/components/app/AppNav';
import { AppMobileNav } from '@/components/app/AppMobileNav';
import { CommandPalette } from '@/components/app/CommandPalette';
import { UserMenu } from '@/components/app/UserMenu';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireViewer();
  const { ingestStale, curateStale } = getStaleness();
  const stale = ingestStale || curateStale;
  const lastSweep = lastOkAt('ingest');
  const sweepTitle = stale
    ? [
        ...(ingestStale ? ['ingest has not succeeded in over 2h'] : []),
        ...(curateStale ? ['curation has not succeeded in over 3h'] : []),
      ].join('; ')
    : 'all scans nominal';

  return (
    <div className="min-h-screen">
      <div aria-hidden className="fixed inset-0 -z-10">
        <RadarBackdrop intensity={0.05} />
      </div>
      <header className="sticky top-0 z-20 border-b border-grat bg-[var(--header-bg)] backdrop-blur">
        <div className="mx-auto flex h-12 max-w-[1200px] items-center gap-3 px-4 sm:px-6">
          <Logo href={paths.app} size="md" />
          <div className="hidden lg:block">
            <AppNav isAdmin={user?.role === 'admin'} />
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
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
            <AppMobileNav
              isAdmin={user?.role === 'admin'}
              userName={user?.name ?? null}
              sweepLabel={lastSweep ? timeAgo(lastSweep) : '—'}
              sweepStale={stale}
              sweepTitle={sweepTitle}
            />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">{children}</main>
      <AnonFresh enabled={!user} />
      <FeedKeys />
    </div>
  );
}
