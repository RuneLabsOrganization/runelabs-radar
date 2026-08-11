import Link from 'next/link';
import { desc, eq, gt } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { boardHistory, stories } from '@/lib/db/schema';
import { DOMAIN_LABELS, isDomain } from '@/lib/domains';
import SectionHeader from '@/components/SectionHeader';

export const metadata = {
  title: 'Changelog',
  description:
    'What changed on the scope: new evaluations, board moves and stack updates — every day the machine sweeps.',
};

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayLabel(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function domainLabel(domain: string): string {
  return isDomain(domain) ? DOMAIN_LABELS[domain] : domain;
}

export default async function ChangelogPage() {
  await requireViewer();
  const db = getDb();
  const cutoff = new Date(Date.now() - 30 * 24 * 36e5);

  const curated = db
    .select()
    .from(stories)
    .where(eq(stories.status, 'curated'))
    .orderBy(desc(stories.createdAt))
    .all()
    .filter((s) => s.createdAt >= cutoff);

  const history = db
    .select()
    .from(boardHistory)
    .where(gt(boardHistory.appliedAt, cutoff))
    .orderBy(desc(boardHistory.appliedAt))
    .all();

  // per day: up to 5 strongest contacts + every board move
  const byDay = new Map<string, { contacts: typeof curated; moves: typeof history }>();
  for (const s of curated) {
    const k = dayKey(s.createdAt);
    const day = byDay.get(k) ?? { contacts: [], moves: [] };
    if (day.contacts.length < 5 && s.topScore >= 40) day.contacts.push(s);
    byDay.set(k, day);
  }
  for (const h of history) {
    const k = dayKey(h.appliedAt);
    const day = byDay.get(k) ?? { contacts: [], moves: [] };
    day.moves.push(h);
    byDay.set(k, day);
  }

  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

  return (
    <div className="mx-auto max-w-[760px] px-6 py-7">
      <div className="readout">what changed &middot; last 30 days</div>
      <h1 className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">Changelog</h1>

      {days.length === 0 && (
        <p className="mono mt-6 text-[12px]" style={{ color: 'var(--ink-4)' }}>
          Nothing on the scope in the last 30 days.
        </p>
      )}

      {days.map(([key, day]) => (
        <section key={key} className="mt-7">
          <SectionHeader label={dayLabel(key)} count={day.contacts.length + day.moves.length} />
          <ul>
            {day.moves.map((h) => (
              <li
                key={`h${h.id}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-[var(--grat-soft)] py-[7px] text-[13px] last:border-b-0"
              >
                <span className="readout shrink-0" style={{ color: 'var(--amber)' }}>
                  board move
                </span>
                <span className="mono shrink-0 text-[11px]" style={{ color: 'var(--ink-3)' }}>
                  {domainLabel(h.domain)} / {h.task}
                </span>
                <span className="min-w-0" style={{ color: 'var(--ink-2)' }}>
                  {h.change}
                </span>
              </li>
            ))}
            {day.contacts.map((s) => (
              <li
                key={`s${s.id}`}
                className="row-hover flex items-baseline gap-3 border-b border-[var(--grat-soft)] py-[7px] text-[13px] last:border-b-0"
              >
                <span className="mono w-8 shrink-0 text-right text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                  {s.topScore}
                </span>
                <Link
                  href={`/story/${s.id}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                  style={{ color: 'var(--ink-2)' }}
                >
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
