import Link from 'next/link';
import { requireViewer } from '@/lib/auth/user';
import { getStaleness, lastOkAt } from '@/lib/jobs';
import { timeAgo } from '@/lib/feed';
import NavLinks from '@/components/NavLinks';
import LogoutButton from '@/components/LogoutButton';
import RadarBackdrop from '@/components/RadarBackdrop';

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
    : 'all sweeps nominal';

  return (
    <div className="min-h-screen">
      {/* whisper-quiet: any louder and the blips read as stray datapoints under charts */}
      <div aria-hidden className="fixed inset-0 -z-10">
        <RadarBackdrop intensity={0.06} />
      </div>
      <header className="sticky top-0 z-20 border-b border-[var(--grat)] bg-[rgba(10,14,19,0.88)] backdrop-blur">
        <div className="mx-auto flex h-12 max-w-[860px] items-center gap-7 px-6">
          <Link
            href="/"
            className="mono flex shrink-0 items-center gap-2 text-[11.5px] font-semibold tracking-[0.16em] text-[var(--ink)]"
          >
            <span aria-hidden className="inline-block h-[10px] w-[3px]" style={{ background: 'var(--phosphor)' }} />
            RUNELABS RADAR
          </Link>
          <NavLinks isAdmin={user?.role === 'admin'} />
          <div className="mono ml-auto flex items-center gap-4 text-[10.5px] tracking-[0.08em] uppercase">
            <span
              className="hidden items-center gap-1.5 sm:flex"
              style={{ color: stale ? 'var(--amber)' : 'var(--ink-4)' }}
              title={sweepTitle}
            >
              <span
                aria-hidden
                className="inline-block h-[6px] w-[6px] rounded-full"
                style={{ background: stale ? 'var(--amber)' : 'var(--phosphor)' }}
              />
              sweep {lastSweep ? timeAgo(lastSweep) : '—'}
            </span>
            {user ? (
              <>
                <span className="hidden text-[var(--ink-4)] md:inline">{user.name}</span>
                <LogoutButton />
              </>
            ) : (
              <Link
                href="/login"
                className="text-[var(--ink-3)] transition-colors hover:text-[var(--ink-2)]"
              >
                sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
