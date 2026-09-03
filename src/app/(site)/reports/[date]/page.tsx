import Link from 'next/link';
import { desc, eq, ne } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { reports } from '@/lib/db/schema';
import { renderMarkdown, stripLeadingH1 } from '@/lib/markdown';
import PageHeader from '@/components/PageHeader';

/* same renderer + typography as the daily brief page (src/app/(hub)/brief/page.tsx) */
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

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function editionLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** UTC wall-clock time of the issue's last write (reruns overwrite createdAt). */
function utcTime(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  return {
    title: `State of the Builder Market — ${date}`,
    description: `The weekly builder-market issue for the week of ${date}: signals, board moves, opportunities, launches and market movers.`,
  };
}

export default async function ReportPage({ params }: { params: Promise<{ date: string }> }) {
  await requireViewer();
  const { date: rawDate } = await params;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;

  const db = getDb();
  const issue = date
    ? (db.select().from(reports).where(eq(reports.date, date)).get() ?? null)
    : null;

  // prev/next navigation across the archive
  const others = db
    .select({ date: reports.date })
    .from(reports)
    .where(issue ? ne(reports.date, issue.date) : undefined)
    .orderBy(desc(reports.date))
    .all();
  const prev = issue ? (others.find((o) => o.date < issue.date) ?? null) : null;
  const next = issue ? ([...others].reverse().find((o) => o.date > issue.date) ?? null) : null;

  const readMinutes = issue ? Math.max(1, Math.round(issue.markdown.split(/\s+/).length / 200)) : 0;

  return (
    <div className="mx-auto max-w-[760px] px-6 py-7">
      <style>{briefStyles}</style>

      <PageHeader
        kicker="weekly report"
        title="State of the Builder Market"
        description="The week's signals, board moves, opportunities, launches and market movers — one issue every Sunday."
      />

      <div className="mono mt-4 text-[10.5px] tracking-[0.06em] uppercase">
        <Link href="/reports" className="transition-colors hover:text-[var(--ink-2)]" style={{ color: 'var(--ink-3)' }}>
          &larr; all issues
        </Link>
      </div>

      {issue ? (
        <>
          {/* edition header: the date IS the identity (same pattern as the brief) */}
          <div className="mt-7 border-b border-[var(--grat)] pb-3">
            <div className="mono text-[19px] font-semibold tracking-[0.06em]" style={{ color: 'var(--ink)' }}>
              WEEK OF {editionLabel(issue.date).slice(4)}
            </div>
            <div className="mono mt-1 text-[10.5px] tracking-[0.06em] uppercase" style={{ color: 'var(--ink-4)' }}>
              written at {utcTime(issue.createdAt)} utc &middot; {readMinutes} min read
            </div>
          </div>

          <article
            className="brief-md mt-6 text-[13.5px] leading-relaxed"
            // Safe: renderMarkdown escapes all input HTML before formatting.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(stripLeadingH1(issue.markdown)) }}
          />

          <div className="mono mt-9 flex items-center justify-between border-t border-[var(--grat)] pt-4 text-[10.5px] tracking-[0.06em] uppercase">
            {prev ? (
              <Link href={`/reports/${prev.date}`} className="transition-colors hover:text-[var(--ink-2)]" style={{ color: 'var(--ink-3)' }}>
                &larr; {prev.date}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={`/reports/${next.date}`} className="transition-colors hover:text-[var(--ink-2)]" style={{ color: 'var(--ink-3)' }}>
                {next.date} &rarr;
              </Link>
            ) : (
              <span />
            )}
          </div>
        </>
      ) : (
        <p className="mono mt-6 text-[12px]" style={{ color: 'var(--ink-4)' }}>
          No issue for {rawDate} — one is written every Sunday.
        </p>
      )}
    </div>
  );
}
