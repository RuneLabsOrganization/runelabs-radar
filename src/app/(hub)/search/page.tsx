import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { timeAgo } from '@/lib/feed';
import DomainTicks, { parseDomainScores } from '@/components/DomainChips';

export const metadata = { title: 'Search', robots: { index: false } };

interface Hit {
  id: number;
  title: string;
  tldr: string | null;
  topScore: number;
  domainScores: string | null;
  createdAt: Date;
}

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

  let hits: Hit[] = [];
  if (query.length >= 2) {
    const match = ftsQuery(query);
    if (match) {
      const db = getDb();
      hits = db.all<Hit>(
        sql`SELECT s.id, s.title, s.tldr, s.top_score as topScore, s.domain_scores as domainScores, s.created_at as createdAt
            FROM stories_fts f JOIN stories s ON s.id = f.rowid
            WHERE stories_fts MATCH ${match} AND s.status = 'curated'
            ORDER BY bm25(stories_fts)
            LIMIT 50`,
      );
      // better-sqlite3 returns created_at as number (ms) — normalize to Date
      hits = hits.map((h) => ({ ...h, createdAt: new Date(h.createdAt) }));
    }
  }

  return (
    <>
      <h1 className="text-[17px] font-semibold tracking-[-0.01em]">Search the scope</h1>
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
          {hits.length} hit{hits.length === 1 ? '' : 's'} for &ldquo;{query}&rdquo;
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
            <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: 'var(--ink-2)' }}>
              {h.title}
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
    </>
  );
}
