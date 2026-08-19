import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { timeAgo } from '@/lib/feed';
import DomainTicks, { parseDomainScores } from '@/components/DomainChips';
import PageHeader from '@/components/PageHeader';

export const metadata = { title: 'Search', robots: { index: false } };

interface Hit {
  id: number;
  title: string;
  tldr: string | null;
  topScore: number;
  domainScores: string | null;
  createdAt: Date;
}

/** Raw FTS row: created_at is unix seconds — raw SQL bypasses drizzle's timestamp mapping. */
type RawHit = Omit<Hit, 'createdAt'> & { createdAt: number };

/** Each token double-quoted → FTS5 treats input as literal terms, never as query syntax. */
function ftsQuery(q: string): string {
  return q
    .replace(/"/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .map((t) => `"${t}"`)
    .join(' ');
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireViewer();
  const { q } = await searchParams;
  const query = (q ?? '').trim().slice(0, 120);

  // '' when no token survives the ≥2-char filter (e.g. "a b") — nothing searchable
  const match = ftsQuery(query);
  let hits: Hit[] = [];
  if (query.length >= 2 && match) {
    const db = getDb();
    hits = db
      .all<RawHit>(
        sql`SELECT s.id, s.title, s.tldr, s.top_score as topScore, s.domain_scores as domainScores, s.created_at as createdAt
            FROM stories_fts f JOIN stories s ON s.id = f.rowid
            WHERE stories_fts MATCH ${match} AND s.status = 'curated'
            ORDER BY bm25(stories_fts)
            LIMIT 50`,
      )
      .map((h) => ({ ...h, createdAt: new Date(h.createdAt * 1000) }));
  }

  return (
    <div className="mx-auto max-w-[760px] px-6 py-7">
      <PageHeader
        title="Search"
        description="Full-text search over every curated story — try a model, tool, org, or technique."
      />
      <form method="GET" action="/search" className="mt-4">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="model, tool, org, technique…"
          autoFocus
          className="input w-full max-w-[420px]"
          aria-label="search stories"
        />
      </form>

      {query.length >= 2 && (
        <p className="mono mt-4 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--ink-4)' }}>
          {match
            ? `${hits.length} hit${hits.length === 1 ? '' : 's'} for “${query}”`
            : 'terms need at least 2 characters'}
        </p>
      )}

      <div className="mt-3 flex flex-col">
        {hits.map((h) => (
          <Link
            key={h.id}
            href={`/story/${h.id}`}
            className="row-hover -mx-2 flex items-baseline gap-2.5 rounded-[3px] px-2 py-[7px]"
          >
            <span className="mono shrink-0 text-[10.5px] tabular-nums" style={{ color: 'var(--ink-4)' }}>
              {timeAgo(h.createdAt)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]" style={{ color: 'var(--ink-2)' }}>
                {h.title}
              </span>
              {h.tldr && (
                <span className="block text-[13px] leading-snug" style={{ color: 'var(--ink-3)' }}>
                  {h.tldr}
                </span>
              )}
            </span>
            <span className="hidden sm:inline-flex">
              <DomainTicks scores={parseDomainScores(h.domainScores)} />
            </span>
            <span className="mono shrink-0 text-[10.5px] tabular-nums" style={{ color: 'var(--ink-3)' }}>
              {h.topScore}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
