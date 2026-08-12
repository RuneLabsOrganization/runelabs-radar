'use client';

import * as React from 'react';
import Link from 'next/link';
import { useState } from 'react';
import { DOMAIN_COLORS, isDomain } from '@/lib/domains';
import { SUB_KEYS } from '@/lib/opportunities/axes';
import { cellAlpha } from '@/lib/heat';
import type { OppView } from './OppDossier';

const AXIS_SHORT: Record<string, string> = {
  demand: 'DEM',
  buildability: 'BLD',
  margin: 'MGN',
  competition: 'CMP',
  timing: 'TIM',
  moat: 'MOT',
  regClear: 'REG',
  platformSafe: 'PLT',
  distribution: 'RCH',
  qualityBar: 'QLT',
};
const AXIS_FULL: Record<string, string> = {
  demand: 'demand',
  buildability: 'buildability',
  margin: 'margin',
  competition: 'open field (higher = less competition)',
  timing: 'timing window',
  moat: 'moat / defensibility',
  regClear: 'regulatory clarity',
  platformSafe: 'platform independence',
  distribution: 'distribution reach',
  qualityBar: 'quality effort needed',
};

/**
 * The assessment matrix: top-N openings × the 10 dossier axes. One glance shows
 * WHERE the field is strong and where it's weak — "all flips fail moat" becomes
 * visible. Absolute 0-20 scale per cell; sticky label column on narrow screens.
 */
export default function AssessmentMatrix({ opps, sortKey }: { opps: OppView[]; sortKey: 'flip' | 'hold' }) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const rows = opps.slice(0, 12);
  const legacyCount = rows.filter((o) => o.legacy).length;
  if (rows.length === 0) return null;

  return (
    <div className="relative mb-6">
      <div className="readout mb-2">assessment matrix &middot; top {rows.length} by {sortKey}</div>
      <div className="overflow-x-auto rounded-[6px] border border-[var(--grat-soft)] bg-[var(--scope-1)] p-2.5">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th
                className="mono sticky left-0 z-10 bg-[var(--scope-1)] text-left text-[9px] uppercase tracking-[0.08em]"
                style={{ color: 'var(--ink-4)', minWidth: 150 }}
              >
                opening
              </th>
              {SUB_KEYS.map((k) => (
                <th
                  key={k}
                  title={AXIS_FULL[k]}
                  className="mono text-center text-[9px] uppercase tracking-[0.04em]"
                  style={{ color: 'var(--ink-4)', cursor: 'default' }}
                >
                  {AXIS_SHORT[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td className="sticky left-0 z-10 bg-[var(--scope-1)] pr-2" style={{ minWidth: 150, maxWidth: 190 }}>
                  <Link
                    href={`/opportunities/${o.id}`}
                    className="flex items-center gap-1.5 truncate text-[11px] hover:underline"
                    style={{ color: 'var(--ink-2)' }}
                  >
                    {o.sector && isDomain(o.sector) && (
                      <span aria-hidden className="inline-block h-[8px] w-[2px] shrink-0" style={{ background: DOMAIN_COLORS[o.sector] }} />
                    )}
                    <span className="truncate">{o.title}</span>
                  </Link>
                </td>
                {SUB_KEYS.map((k) => {
                  if (o.legacy) {
                    return (
                      <td key={k} className="mono text-center text-[10px]" style={{ color: 'var(--ink-4)', width: 26, height: 22 }}>
                        —
                      </td>
                    );
                  }
                  const v = o.sub[k] ?? 0;
                  const color = o.sector && isDomain(o.sector) ? DOMAIN_COLORS[o.sector] : 'var(--phosphor)';
                  return (
                    <td key={k}>
                      <div
                        className="mx-auto rounded-[2px]"
                        title={`${AXIS_FULL[k]}: ${v}/20`}
                        style={{
                          width: 22,
                          height: 20,
                          background: color,
                          opacity: v === 0 ? 0.08 : cellAlpha(v, 20),
                          cursor: 'default',
                        }}
                        onMouseEnter={(e) => {
                          const rect = (e.currentTarget.closest('.relative') as HTMLElement).getBoundingClientRect();
                          setHover({
                            x: e.clientX - rect.left + 10,
                            y: e.clientY - rect.top - 6,
                            text: `${o.title.slice(0, 40)} · ${AXIS_FULL[k]}: ${v}/20`,
                          });
                        }}
                        onMouseLeave={() => setHover(null)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mono mt-1.5 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        cells = dossier sub-score /20 &middot; absolute scale &middot; brighter is stronger
        {legacyCount > 0 && ` · ${legacyCount} opening${legacyCount > 1 ? 's' : ''} pre-date the 10-axis dossier`}
      </p>
      {hover && (
        <div
          className="mono pointer-events-none absolute z-10 max-w-[260px] rounded-[4px] border px-2.5 py-1.5 text-[10.5px]"
          style={{ left: Math.min(hover.x, 500), top: hover.y, background: 'var(--scope-2)', borderColor: 'var(--grat)', color: 'var(--ink-2)' }}
        >
          {hover.text}
        </div>
      )}
    </div>
  );
}
