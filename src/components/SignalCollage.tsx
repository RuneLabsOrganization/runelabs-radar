'use client';

// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import Link from 'next/link';
import { DOMAINS, DOMAIN_COLORS, DOMAIN_LABELS, type Domain } from '@/lib/domains';
import { safeHttpUrl } from '@/lib/safe-url';
import DomainFingerprint from './DomainFingerprint';
import SignalMeter from './SignalMeter';

export interface CollageEntry {
  id: number;
  title: string;
  tldr: string | null;
  score: number;
  /** epoch ms — stamped as data-created for AnonFresh/FeedKeys */
  createdAtMs: number;
  /** epoch ms — max(createdAt, updatedAt); stamped as data-fresh for AnonFresh */
  freshMs: number;
  scores: Partial<Record<Domain, number>> | null;
  /** sectors the story belongs to (membership >= threshold), precomputed server-side */
  domains: Domain[];
  firstUrl: string | null;
  sourceName: string | null;
  isNew: boolean;
  timeLabel: string;
}

type SectorFilter = 'all' | Domain;

interface Filters {
  sector: SectorFilter;
  newOnly: boolean;
  minScore: 40 | 60;
}

const STORAGE_KEY = 'radar.collage.filters.v1';
const DEFAULT_FILTERS: Filters = { sector: 'all', newOnly: false, minScore: 40 };

/** Saved collage preferences — the "make it yours" layer. localStorage only. */
function loadFilters(): Filters {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_FILTERS;
    const p = parsed as Record<string, unknown>;
    const sector =
      p.sector === 'all' || (typeof p.sector === 'string' && (DOMAINS as readonly string[]).includes(p.sector))
        ? (p.sector as SectorFilter)
        : 'all';
    return {
      sector,
      newOnly: p.newOnly === true,
      minScore: p.minScore === 60 ? 60 : 40,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

/**
 * The signal collage: everything below the featured contacts as a filterable
 * masonry wall (Binance-style chip row + Fabric-style columns). Filter picks
 * persist to localStorage — returning users land on their own view.
 */
export default function SignalCollage({ entries }: { entries: CollageEntry[] }) {
  const [filters, setFilters] = React.useState<Filters>(DEFAULT_FILTERS);

  // restore saved prefs after mount (SSR renders the default view first)
  React.useEffect(() => {
    setFilters(loadFilters());
  }, []);
  React.useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // storage full/blocked — filtering still works, it just won't persist
    }
  }, [filters]);

  const { sector, newOnly, minScore } = filters;
  const pool = entries.filter((e) => e.score >= minScore && (!newOnly || e.isNew));
  const shown = sector === 'all' ? pool : pool.filter((e) => e.domains.includes(sector));
  const countFor = (d: Domain) => pool.filter((e) => e.domains.includes(d)).length;
  const freshTotal = entries.filter((e) => e.isNew).length;

  const chip = (key: SectorFilter, label: string, count: number, color?: string) => {
    const active = sector === key;
    return (
      <button
        key={key}
        type="button"
        aria-pressed={active}
        onClick={() => setFilters((f) => ({ ...f, sector: key }))}
        className="mono inline-flex items-center gap-1.5 rounded-[3px] border px-2 py-[3px] text-[10px] tracking-[0.08em] uppercase transition-colors"
        style={{
          borderColor: active ? 'var(--phosphor)' : 'var(--grat)',
          color: active ? 'var(--phosphor)' : 'var(--ink-3)',
          background: active ? 'var(--phosphor-dim)' : 'transparent',
        }}
      >
        {color && <span aria-hidden className="inline-block h-[8px] w-[2px]" style={{ background: color }} />}
        {label}
        <span style={{ color: active ? 'var(--phosphor)' : 'var(--ink-4)' }}>{count}</span>
      </button>
    );
  };

  return (
    <div>
      {/* filter bar — the saved-preferences layer */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {chip('all', 'All', pool.length)}
        {DOMAINS.map((d) => chip(d, DOMAIN_LABELS[d], countFor(d), DOMAIN_COLORS[d]))}
        <span className="mx-1 hidden h-[14px] w-px sm:inline-block" style={{ background: 'var(--grat)' }} aria-hidden />
        <button
          type="button"
          aria-pressed={newOnly}
          onClick={() => setFilters((f) => ({ ...f, newOnly: !f.newOnly }))}
          className="mono rounded-[3px] border px-2 py-[3px] text-[10px] tracking-[0.08em] uppercase transition-colors"
          style={{
            borderColor: newOnly ? 'var(--phosphor)' : 'var(--grat)',
            color: newOnly ? 'var(--phosphor)' : 'var(--ink-3)',
            background: newOnly ? 'var(--phosphor-dim)' : 'transparent',
          }}
        >
          new only{freshTotal > 0 ? ` ${freshTotal}` : ''}
        </button>
        <button
          type="button"
          aria-pressed={minScore === 60}
          onClick={() => setFilters((f) => ({ ...f, minScore: f.minScore === 60 ? 40 : 60 }))}
          className="mono rounded-[3px] border px-2 py-[3px] text-[10px] tracking-[0.08em] uppercase transition-colors"
          style={{
            borderColor: minScore === 60 ? 'var(--phosphor)' : 'var(--grat)',
            color: minScore === 60 ? 'var(--phosphor)' : 'var(--ink-3)',
            background: minScore === 60 ? 'var(--phosphor-dim)' : 'transparent',
          }}
          title="minimum signal strength"
        >
          60+
        </button>
        {sector !== 'all' && (
          <Link
            href={`/domain/${sector}`}
            className="mono ml-auto text-[10px] tracking-[0.08em] uppercase hover:underline"
            style={{ color: 'var(--ink-4)' }}
          >
            {DOMAIN_LABELS[sector]} deep dive &rarr;
          </Link>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="mono text-[12px]" style={{ color: 'var(--ink-4)' }}>
          nothing matches these filters — widen the net.
        </p>
      ) : (
        <div className="columns-1 gap-3 sm:columns-2 lg:columns-3">
          {shown.map((e) => {
            const href = safeHttpUrl(e.firstUrl);
            return (
              <article
                key={e.id}
                className="mb-3 break-inside-avoid rounded-[6px] border border-[var(--grat-soft)] bg-[var(--scope-1)] p-3 transition-colors hover:border-[var(--grat)]"
                data-created={e.createdAtMs}
                data-fresh={e.freshMs}
              >
                <div className="flex items-start gap-2.5">
                  <div className="pt-[3px]">
                    <SignalMeter score={e.score} compact />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[13.5px] font-semibold leading-snug tracking-[-0.01em]">
                      {e.isNew && (
                        <span aria-label="new" className="mr-1" style={{ color: 'var(--phosphor)' }}>
                          &#9679;
                        </span>
                      )}
                      <Link
                        href={`/story/${e.id}`}
                        className="decoration-[var(--grat-strong)] underline-offset-2 hover:underline"
                      >
                        {e.title}
                      </Link>
                      {href && (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="open original source"
                          title="open original source"
                          className="mono ml-1.5 text-[10px]"
                          style={{ color: 'var(--ink-4)' }}
                        >
                          &#8599;
                        </a>
                      )}
                    </h3>
                    {e.tldr && (
                      <p
                        className="mt-1 text-[12.5px] leading-relaxed"
                        style={{
                          color: 'var(--ink-3)',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {e.tldr}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2.5">
                      <DomainFingerprint scores={e.scores} />
                      <span className="mono text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                        {e.sourceName ?? ''}
                      </span>
                      <span className="mono ml-auto text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
                        {e.timeLabel}
                      </span>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
