import Link from 'next/link';
import { desc, eq, gt } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { boardHistory, stories } from '@/lib/db/schema';
import { DOMAIN_LABELS, isDomain } from '@/lib/domains';
import { formatBoardChange, isNoopChange } from '@/lib/board/change';
import { changelogSummary } from '@/lib/changelog';
import { parseDomainScores, topDomain } from '@/components/DomainChips';
import SectionHeader from '@/components/SectionHeader';
import PageHeader from '@/components/PageHeader';

export const metadata = {
  title: 'Changelog',
  description:
    'What changed: new evaluations, board moves and stack updates — refreshed daily.',
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

type EntryType = 'all' | 'contacts' | 'board';

export default async function ChangelogPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  await requireViewer();
  const { type: rawType } = await searchParams;
  const type: EntryType = rawType === 'contacts' || rawType === 'board' ? rawType : 'all';

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
    .all()
    // consistency with /board: "no field changes" rows are noise, not changelog
    .filter((h) => !isNoopChange(h.change));

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

  const summary = changelogSummary(
    curated.map((s) => topDomain(parseDomainScores(s.domainScores))),
    history.map((h) => h.domain),
  );

  const counts = {
    all: { contacts: summary.contacts, moves: summary.moves },
    contacts: { contacts: summary.contacts, moves: 0 },
    board: { contacts: 0, moves: summary.moves },
  }[type];

  const days = [...byDay.entries()]
    .map(([key, day]) => ({
      key,
      contacts: type === 'board' ? [] : day.contacts,
      moves: type === 'contacts' ? [] : day.moves,
    }))
    .filter((d) => d.contacts.length + d.moves.length > 0)
    .sort((a, b) => (a.key < b.key ? 1 : -1));

  const chip = (value: EntryType, label: string, n: number) => (
    <Link
      key={value}
      href={value === 'all' ? '/changelog' : `/changelog?type=${value}`}
      className={`rounded-[3px] border px-2 py-0.5 uppercase transition-colors ${
        type === value
          ? 'border-[var(--phosphor)] text-[var(--ink)]'
          : 'border-[var(--grat)] text-[var(--ink-3)] hover:border-[var(--grat-strong)]'
      }`}
    >
      {label} {n}
    </Link>
  );

  return (
    <div className="mx-auto max-w-[760px] px-6 py-7">
      <div className="readout flex items-center gap-3">
        <span>what changed &middot; last 30 days</span>
        <a href="/changelog.xml" className="transition-colors hover:text-[var(--ink-2)]" style={{ color: 'var(--ink-3)' }}>
          rss ↗
        </a>
      </div>
      <PageHeader
        title="Changelog"
        description="The full audit trail: every story the radar kept, and every board move and stack update that followed."
      />
      <p className="mono mt-2.5 text-[10.5px] tracking-[0.06em] uppercase" style={{ color: 'var(--ink-4)' }}>
        {summary.contacts} stories &middot; {summary.moves} board moves
        {summary.topSector && isDomain(summary.topSector) && (
          <span> &middot; busiest sector: {DOMAIN_LABELS[summary.topSector]}</span>
        )}
      </p>

      <div className="mono mt-4 flex flex-wrap items-center gap-1.5 text-[10.5px] tracking-[0.06em]">
        {chip('all', 'all', summary.contacts + summary.moves)}
        {chip('contacts', 'stories', summary.contacts)}
        {chip('board', 'board moves', summary.moves)}
      </div>

      {days.length === 0 && (
        <p className="mono mt-6 text-[12px]" style={{ color: 'var(--ink-4)' }}>
          Nothing tracked in the last 30 days.
        </p>
      )}

      {days.map((day) => (
        <section key={day.key} className="mt-7">
          <SectionHeader label={dayLabel(day.key)} count={day.contacts.length + day.moves.length} />
          <ul>
            {day.moves.map((h) => {
              const fields = formatBoardChange(h.change);
              return (
                <li key={`h${h.id}`} className="border-b border-[var(--grat-soft)] py-[7px] text-[13px] last:border-b-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="readout shrink-0" style={{ color: 'var(--amber)' }}>
                      board move
                    </span>
                    <span className="mono shrink-0 text-[11px]" style={{ color: 'var(--ink-3)' }}>
                      {domainLabel(h.domain)} / {h.task}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-col gap-0.5 pl-[76px]">
                    {fields.map((f, i) => (
                      <span key={i} className="min-w-0 truncate" style={{ color: 'var(--ink-2)' }}>
                        <span className="mono text-[10.5px] uppercase tracking-[0.06em]" style={{ color: 'var(--ink-4)' }}>
                          {f.field}{' '}
                        </span>
                        {f.text}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
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

      <p className="mono mt-8 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        {counts.contacts + counts.moves} entries shown &middot; empty sync rows hidden by design
      </p>
    </div>
  );
}
