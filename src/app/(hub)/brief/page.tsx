import { and, desc, eq, gte, lt } from 'drizzle-orm';
import Link from 'next/link';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { briefs, stories } from '@/lib/db/schema';
import { renderMarkdown } from '@/lib/markdown';
import PageHeader from '@/components/PageHeader';

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

export const metadata = {
  title: 'Daily Brief',
  description:
    'The daily AI intelligence brief: top stories, board changes and what the machine noticed — written every morning at 07:00.',
};

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function editionLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The brief's own H1 duplicates the edition header — drop the first heading line. */
function stripLeadingH1(md: string): string {
  return md.replace(/^#\s+[^\n]+\n+/, '');
}

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

  // the stories behind the edition: that day's strongest curated contacts
  const behindTheBrief = selected
    ? db
        .select({ id: stories.id, title: stories.title, topScore: stories.topScore })
        .from(stories)
        .where(
          and(
            eq(stories.status, 'curated'),
            gte(stories.createdAt, new Date(`${selected.date}T00:00:00Z`)),
            lt(stories.createdAt, new Date(new Date(`${selected.date}T00:00:00Z`).getTime() + 864e5)),
          ),
        )
        .orderBy(desc(stories.topScore))
        .limit(5)
        .all()
    : [];

  const readMinutes = selected
    ? Math.max(1, Math.round(selected.markdown.split(/\s+/).length / 200))
    : 0;
  const isToday = currentDate === new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-[760px] px-6 py-7">
      <style>{briefStyles}</style>

      <PageHeader
        kicker="daily brief &middot; written at 07:00 sharp"
        title="Brief"
        description="Yesterday's AI news in five minutes — written every morning, with the board changes that matter."
      />

      {recentDates.length === 0 ? (
        <p className="mono mt-6 text-[12px]" style={{ color: 'var(--ink-4)' }}>
          No briefs yet — the 07:00 job writes the first one.
        </p>
      ) : (
        <>
          <div className="mono mt-4 flex flex-wrap items-center gap-1.5 text-[10.5px]">
            {recentDates.map(({ date: d }) => {
              const active = d === currentDate;
              const wd = WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()];
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
                  {wd} {d.slice(8)}
                </Link>
              );
            })}
          </div>

          {selected ? (
            <>
              {/* edition header: the date IS the identity (Bloomberg/MFP pattern) */}
              <div className="mt-7 border-b border-[var(--grat)] pb-3">
                <div className="mono text-[19px] font-semibold tracking-[0.06em]" style={{ color: 'var(--ink)' }}>
                  {editionLabel(selected.date)}
                  {isToday && (
                    <span className="ml-2.5 text-[10.5px] uppercase tracking-[0.1em]" style={{ color: 'var(--phosphor)' }}>
                      ● today
                    </span>
                  )}
                </div>
                <div className="mono mt-1 text-[10.5px] tracking-[0.06em] uppercase" style={{ color: 'var(--ink-4)' }}>
                  written at 07:00 &middot; {readMinutes} min read
                </div>
              </div>

              <article
                className="brief-md mt-6 text-[13.5px] leading-relaxed"
                // Safe: renderMarkdown escapes all input HTML before formatting.
                dangerouslySetInnerHTML={{ __html: renderMarkdown(stripLeadingH1(selected.markdown)) }}
              />

              {behindTheBrief.length > 0 && (
                <div className="mt-9">
                  <div className="readout mb-2">the stories behind the brief &middot; {behindTheBrief.length}</div>
                  <ul>
                    {behindTheBrief.map((s) => (
                      <li
                        key={s.id}
                        className="row-hover flex items-baseline gap-3 border-b border-[var(--grat-soft)] py-[7px] text-[13px] last:border-b-0"
                      >
                        <span className="mono w-8 shrink-0 text-right text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                          {s.topScore}
                        </span>
                        <Link
                          href={`/story/${s.id}`}
                          className="min-w-0 flex-1 truncate decoration-[var(--grat-strong)] underline-offset-2 hover:underline"
                          style={{ color: 'var(--ink-2)' }}
                        >
                          {s.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
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
