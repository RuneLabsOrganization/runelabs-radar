'use client';

import * as React from 'react';
import { useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  DOMAINS,
  DOMAIN_COLORS,
  DOMAIN_LABELS,
  DOMAIN_MEMBERSHIP_THRESHOLD,
  type Domain,
} from '@/lib/domains';
import type { FeedStory } from '@/lib/feed';
import { parseDomainScores, topDomain } from './DomainChips';
import ScanRow from './ScanRow';
import SectionHeader from './SectionHeader';
import SignalEntry from './SignalEntry';

export interface FeedEntry {
  story: FeedStory;
  itemCount: number;
  firstUrl: string | null;
  sourceName: string | null;
  up: number;
  down: number;
  myVote: 1 | -1 | 0;
  isNew: boolean;
  score: number;
  /** server-computed so SSR and hydration render identical text */
  timeLabel: string;
}

function sectorScore(e: FeedEntry, sector: Domain): number {
  return parseDomainScores(e.story.domainScores)?.[sector] ?? 0;
}

/** Pure filter used by the feed — exported for tests. */
export function filterBySector(entries: FeedEntry[], sector: Domain | null): FeedEntry[] {
  if (sector === null) return entries;
  return entries.filter((e) => sectorScore(e, sector) >= DOMAIN_MEMBERSHIP_THRESHOLD);
}

/**
 * The briefing feed with in-place sector cross-filtering: one click scopes
 * both Top signals and the Scan log without leaving the page. The active
 * sector lives in the `?sector=` search param so filters survive refresh
 * and are shareable.
 */
export default function FilteredFeed({
  top,
  scan,
  readOnly,
}: {
  top: FeedEntry[];
  scan: FeedEntry[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get('sector');
  const sector: Domain | null = raw && (DOMAINS as readonly string[]).includes(raw) ? (raw as Domain) : null;

  function setSector(next: Domain | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set('sector', next);
    else params.delete('sector');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const counts = useMemo(() => {
    const all = [...top, ...scan];
    return Object.fromEntries(
      DOMAINS.map((d) => [d, filterBySector(all, d).length]),
    ) as Record<Domain, number>;
  }, [top, scan]);

  const shownTop = filterBySector(top, sector);
  const shownScan = filterBySector(scan, sector);

  return (
    <div>
      <div className="mono mt-8 flex flex-wrap items-center gap-1.5 text-[10px] tracking-[0.06em]">
        <span style={{ color: 'var(--ink-4)' }}>filter</span>
        <button
          type="button"
          onClick={() => setSector(null)}
          aria-pressed={sector === null}
          className={`cursor-pointer rounded-[3px] border px-2 py-0.5 uppercase transition-colors ${
            sector === null
              ? 'border-[var(--phosphor)] text-[var(--ink)]'
              : 'border-[var(--grat)] text-[var(--ink-3)] hover:border-[var(--grat-strong)]'
          }`}
        >
          all
        </button>
        {DOMAINS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setSector(sector === d ? null : d)}
            aria-pressed={sector === d}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[3px] border px-2 py-0.5 uppercase transition-colors ${
              sector === d
                ? 'border-[var(--phosphor)] text-[var(--ink)]'
                : 'border-[var(--grat)] text-[var(--ink-3)] hover:border-[var(--grat-strong)]'
            }`}
          >
            <span aria-hidden className="inline-block h-[8px] w-[2px]" style={{ background: DOMAIN_COLORS[d] }} />
            {DOMAIN_LABELS[d]}
            <span style={{ color: 'var(--ink-4)' }}>{counts[d]}</span>
          </button>
        ))}
      </div>

      <SectionHeader label="Top stories" count={shownTop.length} tone="phosphor" />
      {shownTop.length === 0 ? (
        <p className="mono py-4 text-[12px]" style={{ color: 'var(--ink-4)' }}>
          {sector
            ? `No strong ${DOMAIN_LABELS[sector]} stories on the radar right now.`
            : 'No strong stories on the radar yet — curation runs hourly.'}
        </p>
      ) : (
        <div>
          {shownTop.map((e) => (
            <SignalEntry
              key={e.story.id}
              story={e.story}
              itemCount={e.itemCount}
              firstUrl={e.firstUrl}
              sourceName={e.sourceName}
              up={e.up}
              down={e.down}
              myVote={e.myVote}
              isNew={e.isNew}
              highlightDomain={sector ?? undefined}
              readOnly={readOnly}
              timeLabel={e.timeLabel}
            />
          ))}
        </div>
      )}

      {shownScan.length > 0 && (
        <>
          <SectionHeader label="Scan log" count={shownScan.length} />
          <ul>
            {shownScan.map((e) => {
              const scores = parseDomainScores(e.story.domainScores);
              return (
                <ScanRow
                  key={e.story.id}
                  story={e.story}
                  firstUrl={e.firstUrl}
                  score={sector ? (scores?.[sector] ?? 0) : e.score}
                  domain={sector ?? topDomain(scores)}
                  isNew={e.isNew}
                  timeLabel={e.timeLabel}
                />
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
