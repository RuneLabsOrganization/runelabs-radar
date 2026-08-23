import type { Metadata } from 'next';
import { asc } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { boardEntries } from '@/lib/db/schema';
import { DOMAIN_COLORS, DOMAIN_LABELS, DOMAINS, isDomain } from '@/lib/domains';
import { getIdentity } from '@/lib/identity';
import { urls } from '@/lib/urls';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Best Right Now — embed',
  robots: { index: false, follow: false },
};

/**
 * Embeddable "Best right now" widget — a chrome-free, iframe-friendly board.
 * Optional ?domain=coding scopes it to one domain; a non-empty domain that
 * isn't a known slug gets an "unknown domain" notice instead of silently
 * rendering the full board. Attribution footer links back to the full board
 * (that's the citation flywheel — keep it).
 */
export default async function EmbedBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string }>;
}) {
  await requireViewer();
  const { domain } = await searchParams;
  const filter = typeof domain === 'string' && isDomain(domain) ? domain : null;

  if (domain && !filter) {
    return (
      <div
        className="mx-auto flex max-w-[420px] items-center justify-center px-3 py-6"
        style={{ background: 'var(--scope-0)' }}
      >
        <p className="mono text-[11px]" style={{ color: 'var(--ink-4)' }}>
          unknown domain: {domain}
        </p>
      </div>
    );
  }

  const rows = getDb().select().from(boardEntries)
    .orderBy(asc(boardEntries.domain), asc(boardEntries.task))
    .all()
    .filter((r) => !filter || r.domain === filter);

  const domains = filter ? [filter] : DOMAINS;
  const id = getIdentity();

  return (
    <div className="mx-auto max-w-[420px] px-3 py-2.5" style={{ background: 'var(--scope-0)' }}>
      {domains.map((d) => {
        const entries = rows.filter((r) => r.domain === d);
        if (entries.length === 0) return null;
        return (
          <section key={d} className="mb-2.5 last:mb-0">
            <div className="readout flex items-center gap-1.5" style={{ color: 'var(--ink-3)' }}>
              <span aria-hidden className="inline-block h-[8px] w-[2px]" style={{ background: DOMAIN_COLORS[d] }} />
              {DOMAIN_LABELS[d]}
            </div>
            <ul className="mt-1">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="flex items-baseline gap-2 border-b border-[var(--grat-soft)] py-[5px] text-[12px] last:border-b-0"
                >
                  <span className="mono shrink-0 text-[10px] uppercase tracking-[0.06em]" style={{ color: 'var(--ink-4)' }}>
                    {e.task}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium" style={{ color: 'var(--ink)' }}>
                    {e.bestOverall ?? '—'}
                  </span>
                  {e.bestValue && e.bestValue !== e.bestOverall && (
                    <span className="mono shrink-0 text-[10px]" style={{ color: 'var(--ink-4)' }}>
                      value: {e.bestValue}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {rows.length === 0 && (
        <p className="mono text-[11px]" style={{ color: 'var(--ink-4)' }}>
          No board entries yet.
        </p>
      )}
      <div className="mt-2 border-t border-[var(--grat-soft)] pt-1.5 text-right">
        <a
          href={urls.tools()}
          target="_blank"
          rel="noreferrer"
          className="mono text-[10px] uppercase tracking-[0.08em]"
          style={{ color: 'var(--ink-4)' }}
        >
          best right now · <span style={{ color: 'var(--phosphor)' }}>{id.productName}</span>
        </a>
      </div>
    </div>
  );
}
