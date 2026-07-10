import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { briefs } from '@/lib/db/schema';
import { renderMarkdown } from '@/lib/markdown';

const briefStyles = `
.brief-md h1 { font-size: 17px; font-weight: 650; margin: 14px 0 6px; }
.brief-md h2 { font-size: 15px; font-weight: 600; margin: 12px 0 6px; }
.brief-md h3 { font-family: var(--font-readout); font-size: 10.5px; font-weight: 500; margin: 14px 0 4px; color: var(--ink-4); text-transform: uppercase; letter-spacing: 0.12em; }
.brief-md p { margin: 6px 0; color: var(--ink-2); }
.brief-md ul { margin: 6px 0; padding-left: 18px; list-style: disc; color: var(--ink-2); }
.brief-md li { margin: 2px 0; }
.brief-md a { color: var(--phosphor); text-decoration: underline; text-decoration-color: var(--grat-strong); text-underline-offset: 2px; }
.brief-md code { background: var(--scope-inset); border: 1px solid var(--grat); border-radius: 3px; padding: 0 4px; font-size: 12px; font-family: var(--font-readout); }
.brief-md strong { font-weight: 600; color: var(--ink); }
.brief-md > :first-child { margin-top: 0; }
.brief-md > :last-child { margin-bottom: 0; }
`;

export default async function BriefPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  await requireViewer();
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

  const selected =
    recentDates.length === 0
      ? null
      : date
        ? (db.select().from(briefs).where(eq(briefs.date, date)).get() ?? null)
        : (db.select().from(briefs).orderBy(desc(briefs.date)).limit(1).get() ?? null);

  const currentDate = selected?.date ?? date;

  return (
    <div className="mx-auto max-w-[760px] px-6 py-7">
      <style>{briefStyles}</style>

      <div className="readout">daily brief &middot; written at the 07:00 sweep</div>
      <h1 className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">Brief</h1>

      {recentDates.length === 0 ? (
        <p className="mono mt-6 text-[12px]" style={{ color: 'var(--ink-4)' }}>
          No briefs yet — the 07:00 job writes the first one.
        </p>
      ) : (
        <>
          <div className="mono mt-4 flex flex-wrap items-center gap-1.5 text-[10.5px]">
            {recentDates.map(({ date: d }) => {
              const active = d === currentDate;
              return (
                <Link
                  key={d}
                  href={`/brief?date=${d}`}
                  className={`rounded-[3px] border px-2 py-0.5 transition-colors ${
                    active
                      ? 'border-[var(--phosphor)] text-[var(--ink)]'
                      : 'border-[var(--grat)] text-[var(--ink-3)] hover:border-[var(--grat-strong)]'
                  }`}
                >
                  {d}
                </Link>
              );
            })}
          </div>

          {selected ? (
            <article
              className="brief-md mt-6 text-[13.5px] leading-relaxed"
              // Safe: renderMarkdown escapes all input HTML before formatting.
              dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.markdown) }}
            />
          ) : (
            <p className="mono mt-6 text-[12px]" style={{ color: 'var(--ink-4)' }}>
              No brief for {date}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
