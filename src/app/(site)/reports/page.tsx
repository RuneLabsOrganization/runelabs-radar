import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { reports } from '@/lib/db/schema';
import PageHeader from '@/components/PageHeader';

export const metadata = {
  title: 'Weekly Report',
  description:
    'State of the Builder Market — the weekly issue: top signals, board moves, opportunities, launches and market movers, written every Sunday.',
};

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function editionLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** First non-heading line of the issue as the archive teaser. */
function teaser(markdown: string): string {
  const line = markdown
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'));
  return (line ?? '').replace(/\*\*/g, '').slice(0, 180);
}

export default async function ReportsPage() {
  await requireViewer();
  const rows = getDb().select().from(reports).orderBy(desc(reports.date)).all();

  return (
    <div className="mx-auto max-w-[760px] px-6 py-7">
      <PageHeader
        kicker="weekly report · every sunday"
        title="State of the Builder Market"
        description="One issue per week: the signals, board moves, opportunities, launches and market movers a builder should act on."
      />

      {rows.length === 0 ? (
        <p className="mono mt-6 text-[12px]" style={{ color: 'var(--ink-4)' }}>
          No issues yet — the Sunday 08:00 job writes the first one.
        </p>
      ) : (
        <ul className="mt-6">
          {rows.map((r) => {
            const readMinutes = Math.max(1, Math.round(r.markdown.split(/\s+/).length / 200));
            return (
              <li key={r.date} className="border-b border-[var(--grat-soft)] py-[10px] last:border-b-0">
                <div className="flex items-baseline gap-3">
                  <Link
                    href={`/reports/${r.date}`}
                    className="mono shrink-0 text-[12.5px] font-semibold tracking-[0.06em] hover:underline"
                    style={{ color: 'var(--ink)' }}
                  >
                    {editionLabel(r.date)}
                  </Link>
                  <span className="mono shrink-0 text-[10.5px] tracking-[0.06em] uppercase" style={{ color: 'var(--ink-4)' }}>
                    {r.date} &middot; {readMinutes} min
                  </span>
                </div>
                {teaser(r.markdown) && (
                  <p className="mt-1 truncate text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                    {teaser(r.markdown)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
