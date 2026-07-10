import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { briefs } from '@/lib/db/schema';
import { renderMarkdown } from '@/lib/markdown';

const briefStyles = `
.brief-md h1 { font-size: 17px; font-weight: 650; margin: 14px 0 6px; }
.brief-md h2 { font-size: 15px; font-weight: 600; margin: 12px 0 6px; }
.brief-md h3 { font-size: 12px; font-weight: 600; margin: 10px 0 4px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
.brief-md p { margin: 6px 0; }
.brief-md ul { margin: 6px 0; padding-left: 18px; list-style: disc; }
.brief-md li { margin: 2px 0; }
.brief-md a { color: var(--accent); text-decoration: underline; }
.brief-md code { background: var(--panel-2); border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; font-size: 12px; font-family: ui-monospace, monospace; }
.brief-md strong { font-weight: 600; }
.brief-md > :first-child { margin-top: 0; }
.brief-md > :last-child { margin-bottom: 0; }
`;

export default async function BriefPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  await requireUser();
  const params = await searchParams;
  const rawDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;

  const db = getDb();
  const recentDates = db
    .select({ date: briefs.date })
    .from(briefs)
    .orderBy(desc(briefs.date))
    .limit(14)
    .all();

  if (recentDates.length === 0) {
    return (
      <div className="card">
        <h1 className="section-title">Daily brief</h1>
        <p className="muted">No briefs yet. The 7:00 job writes the first brief.</p>
      </div>
    );
  }

  const selected = date
    ? (db.select().from(briefs).where(eq(briefs.date, date)).get() ?? null)
    : (db.select().from(briefs).orderBy(desc(briefs.date)).limit(1).get() ?? null);

  const currentDate = selected?.date ?? date;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{briefStyles}</style>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {recentDates.map(({ date: d }) => {
          const active = d === currentDate;
          return (
            <Link
              key={d}
              href={`/brief?date=${d}`}
              className="badge"
              style={
                active
                  ? {
                      borderColor: 'var(--accent)',
                      color: 'var(--text)',
                      background: 'var(--accent-soft)',
                    }
                  : undefined
              }
            >
              {d}
            </Link>
          );
        })}
      </div>

      {selected ? (
        <article
          className="card brief-md"
          // Safe: renderMarkdown escapes all input HTML before formatting.
          dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.markdown) }}
        />
      ) : (
        <div className="card">
          <p className="muted">No brief for {date}.</p>
        </div>
      )}
    </div>
  );
}
