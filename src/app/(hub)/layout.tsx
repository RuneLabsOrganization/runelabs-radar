import Link from 'next/link';
import { and, eq, gt } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { stories } from '@/lib/db/schema';
import { getStaleness } from '@/lib/jobs';
import {
  DOMAINS,
  DOMAIN_COLORS,
  DOMAIN_LABELS,
  DOMAIN_MEMBERSHIP_THRESHOLD,
  type Domain,
} from '@/lib/domains';
import { parseDomainScores } from '@/components/DomainChips';
import LogoutButton from '@/components/LogoutButton';

const navLinkClass =
  'flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--panel-2)]';

/** Curated stories newer than the user's last visit, counted per domain. */
function unreadByDomain(lastSeenAt: Date | null): Record<Domain, number> {
  const db = getDb();
  const rows = db
    .select({ domainScores: stories.domainScores })
    .from(stories)
    .where(
      and(eq(stories.status, 'curated'), gt(stories.createdAt, lastSeenAt ?? new Date(0))),
    )
    .all();
  const unread = Object.fromEntries(DOMAINS.map((d) => [d, 0])) as Record<Domain, number>;
  for (const row of rows) {
    const scores = parseDomainScores(row.domainScores);
    if (!scores) continue;
    for (const d of DOMAINS) {
      if ((scores[d] ?? 0) >= DOMAIN_MEMBERSHIP_THRESHOLD) unread[d] += 1;
    }
  }
  return unread;
}

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { ingestStale, curateStale } = getStaleness();
  const unread = unreadByDomain(user.lastSeenAt);

  const warnings = [
    ...(ingestStale ? ["Ingestion hasn't run in over 2h"] : []),
    ...(curateStale ? ["Curation hasn't run in over 3h"] : []),
  ];

  return (
    <div className="min-h-screen">
      <aside
        className="fixed inset-y-0 left-0 z-10 flex w-[200px] flex-col border-r px-3 py-4"
        style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
      >
        <Link href="/" className="px-2 text-[15px] font-bold tracking-tight">
          Runelabs <span style={{ color: 'var(--accent)' }}>Radar</span>
        </Link>

        <nav className="mt-5 flex flex-col gap-0.5 text-[13px]">
          <Link href="/" className={navLinkClass}>
            Today
          </Link>

          <div className="section-title mt-4 px-2">Domains</div>
          {DOMAINS.map((d) => (
            <Link key={d} href={`/domain/${d}`} className={navLinkClass}>
              <span
                aria-hidden
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: DOMAIN_COLORS[d] }}
              />
              <span className="min-w-0 flex-1 truncate">{DOMAIN_LABELS[d]}</span>
              {unread[d] > 0 && (
                <span
                  className="badge"
                  style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                >
                  {unread[d]}
                </span>
              )}
            </Link>
          ))}

          <div className="section-title mt-4 px-2">Radar</div>
          <Link href="/board" className={navLinkClass}>
            Board
          </Link>
          <Link href="/brief" className={navLinkClass}>
            Brief
          </Link>
          {user.role === 'admin' && (
            <Link href="/admin" className={navLinkClass}>
              Admin
            </Link>
          )}
        </nav>

        <div className="mt-auto border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <div className="px-2 pb-2 text-[12px]">
            {user.name}
            {user.role === 'admin' && <span className="muted"> &middot; admin</span>}
          </div>
          <LogoutButton />
        </div>
      </aside>

      <div className="ml-[200px]">
        {warnings.length > 0 && (
          <div
            className="border-b px-6 py-2 text-[13px] font-medium"
            style={{
              color: 'var(--warn)',
              background: 'rgba(224, 169, 53, 0.1)',
              borderColor: 'var(--border)',
            }}
          >
            {warnings.join(' · ')}
          </div>
        )}
        <main>{children}</main>
      </div>
    </div>
  );
}
