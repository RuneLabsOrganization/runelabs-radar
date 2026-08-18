import Link from 'next/link';
import { requireViewer } from '@/lib/auth/user';
import { getIdentity } from '@/lib/identity';
import { getStaleness, lastOkAt } from '@/lib/jobs';
import { timeAgo } from '@/lib/feed';
import NavLinks from '@/components/NavLinks';
import MobileNav from '@/components/MobileNav';
import AnonFresh from '@/components/AnonFresh';
import FeedKeys from '@/components/FeedKeys';
import LogoutButton from '@/components/LogoutButton';
import RadarBackdrop from '@/components/RadarBackdrop';
import ThemeToggle from '@/components/ThemeToggle';

export default async function HubLayout({ children }: { children: React.ReactNode }) {
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
      {/* whisper-quiet: any louder and the blips read as stray datapoints under charts */}
      <div aria-hidden className="fixed inset-0 -z-10">
        <RadarBackdrop intensity={0.06} />
      </div>
      <header className="sticky top-0 z-20 border-b border-[var(--grat)] bg-[var(--header-bg)] backdrop-blur">
        <div className="mx-auto flex h-12 max-w-[1100px] items-center gap-3 px-4 sm:px-6 lg:gap-5">
          <Link
            href="/"
            className="mono flex shrink-0 items-center gap-2 text-[11.5px] font-semibold tracking-[0.16em] text-[var(--ink)]"
          >
            <span aria-hidden className="inline-block h-[10px] w-[3px]" style={{ background: 'var(--phosphor)' }} />
            {getIdentity().productName.toUpperCase()}
          </Link>
          <div className="hidden lg:block">
            <NavLinks isAdmin={user?.role === 'admin'} />
          </div>
          <div className="mono ml-auto hidden items-center gap-3 text-[10.5px] tracking-[0.08em] uppercase lg:flex">
            <ThemeToggle />
            <Link href="/search" className="whitespace-nowrap transition-colors hover:text-[var(--ink-2)]" style={{ color: 'var(--ink-3)' }}>
              search
            </Link>
            <span
              className="hidden items-center gap-1.5 whitespace-nowrap lg:flex"
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
            {user ? (
              <>
                <span className="hidden text-[var(--ink-4)] xl:inline">{user.name}</span>
                <LogoutButton />
              </>
            ) : (
              <Link
                href="/login"
                className="whitespace-nowrap text-[var(--ink-3)] transition-colors hover:text-[var(--ink-2)]"
              >
                sign in
              </Link>
            )}
          </div>
          <MobileNav
            isAdmin={user?.role === 'admin'}
            userName={user?.name ?? null}
            sweepLabel={lastSweep ? timeAgo(lastSweep) : '—'}
            sweepStale={stale}
            sweepTitle={sweepTitle}
          />
        </div>
      </header>
      <main>{children}</main>
      <AnonFresh enabled={!user} />
      <FeedKeys />
    </div>
  );
}
