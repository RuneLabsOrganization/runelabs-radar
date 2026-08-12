'use client';

import * as React from 'react';
import { useMemo, useState } from 'react';
import { DOMAINS, DOMAIN_COLORS, DOMAIN_LABELS, type Domain } from '@/lib/domains';
import type { DayCount } from '@/lib/analytics';
import { cellAlpha, globalMax, isWeekend, rowMaxes } from '@/lib/heat';

const W = 640;
const LABEL_W = 66;
const ROW_H = 22;
const GAP = 2;
const LABEL_H = 16;

export type ScaleMode = 'per-sector' | 'absolute';

/**
 * Sector × day activity heatmap: every sector readable at once — no overlapping
 * polylines, no dominant-axis squish. X-style rounded chips (Mobbin), GitHub
 * neutral zero cells, cell-local tooltip. `per-sector` scale (default) normalizes
 * each row to its own max = the quiet-sector fairness fix; `absolute` shows true
 * volume. Spike detections get a phosphor dot in the cell corner.
 */
export default function ActivityHeatmap({
  days,
  focus,
  spikes,
}: {
  days: DayCount[];
  focus?: Domain;
  spikes?: { date: string; domain: string }[];
}) {
  const [mode, setMode] = useState<ScaleMode>('per-sector');
  const [hover, setHover] = useState<{ x: number; y: number; day: DayCount; domain: Domain } | null>(null);

  const rows = useMemo(() => rowMaxes(days), [days]);
  const gmax = useMemo(() => globalMax(days), [days]);
  const cellW = days.length > 0 ? (W - LABEL_W - GAP) / days.length - GAP : 0;
  const H = LABEL_H + DOMAINS.length * (ROW_H + GAP);

  const spikeSet = useMemo(() => new Set((spikes ?? []).map((s) => `${s.date}|${s.domain}`)), [spikes]);

  const cellX = (i: number) => LABEL_W + i * (cellW + GAP);
  const cellY = (r: number) => LABEL_H + r * (ROW_H + GAP);

  return (
    <div className="relative">
      {/* scale toggle */}
      <div className="mono mb-2 flex items-center gap-1.5 text-[10px] tracking-[0.06em]">
        <span style={{ color: 'var(--ink-4)' }}>scale</span>
        {(['per-sector', 'absolute'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`cursor-pointer rounded-[3px] border px-2 py-0.5 uppercase transition-colors ${
              mode === m
                ? 'border-[var(--phosphor)] text-[var(--ink)]'
                : 'border-[var(--grat)] text-[var(--ink-3)] hover:border-[var(--grat-strong)]'
            }`}
          >
            {m === 'per-sector' ? 'per sector' : 'absolute'}
          </button>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Sector activity heatmap: rows are sectors, columns are days">
        {DOMAINS.map((d, r) => {
          const dimmed = focus && focus !== d;
          return (
            <g key={d} opacity={dimmed ? 0.35 : 1} style={{ transition: 'opacity 200ms ease' }}>
              {/* row label */}
              <rect x={0} y={cellY(r) + ROW_H / 2 - 4.5} width={2} height={9} fill={DOMAIN_COLORS[d]} />
              <text
                x={6}
                y={cellY(r) + ROW_H / 2 + 3.5}
                fontSize={10}
                fontFamily="var(--font-readout)"
                fill="var(--ink-3)"
                style={{ letterSpacing: '0.06em' }}
              >
                {DOMAIN_LABELS[d].toUpperCase()}
              </text>
              {days.map((day, i) => {
                const v = day.byDomain[d] ?? 0;
                const max = mode === 'per-sector' ? rows[d] : gmax;
                const a = cellAlpha(v, max);
                const isSpike = spikeSet.has(`${day.date}|${d}`);
                return (
                  <g key={day.date}>
                    <rect
                      x={cellX(i)}
                      y={cellY(r)}
                      width={cellW}
                      height={ROW_H}
                      rx={2}
                      fill={a === 0 ? 'var(--grat-soft)' : DOMAIN_COLORS[d]}
                      fillOpacity={a === 0 ? 0.5 : a}
                      className="heat-cell"
                      style={{ animationDelay: `${(r * days.length + i) * 8}ms` }}
                      onMouseEnter={(e) => {
                        const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                        setHover({
                          x: Math.min(((cellX(i) + cellW / 2) / W) * rect.width, Math.max(0, rect.width - 240)),
                          y: (cellY(r) / H) * rect.height,
                          day,
                          domain: d,
                        });
                      }}
                      onMouseLeave={() => setHover(null)}
                    >
                      <title>{`${day.date} · ${DOMAIN_LABELS[d]} · ${v} stories`}</title>
                    </rect>
                    {isSpike && (
                      <circle
                        cx={cellX(i) + cellW - 4}
                        cy={cellY(r) + 4}
                        r={2.2}
                        fill="var(--phosphor)"
                        style={{ pointerEvents: 'none' }}
                      />
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
        {/* column labels: every other day, weekends dimmer */}
        {days.map((day, i) =>
          i % 2 === 0 ? (
            <text
              key={day.date}
              x={cellX(i) + cellW / 2}
              y={H - 2}
              textAnchor="middle"
              fontSize={10}
              fontFamily="var(--font-readout)"
              fill={isWeekend(day.date) ? 'var(--ink-4)' : 'var(--ink-3)'}
            >
              {day.date.slice(5)}
            </text>
          ) : null,
        )}
      </svg>

      {/* legend: 4-step ramp + scale note */}
      <div className="mono mt-1.5 flex items-center gap-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        <span aria-hidden className="flex gap-[2px]">
          {[0.12, 0.3, 0.57, 1].map((o) => (
            <span
              key={o}
              className="inline-block h-[8px] w-[8px] rounded-[2px]"
              style={{ background: 'var(--phosphor)', opacity: o }}
            />
          ))}
        </span>
        {mode === 'per-sector' ? 'scaled per sector — compare shape, not volume' : 'absolute volume — coding dominates by design'}
      </div>

      {hover && (
        <div
          className="mono pointer-events-none absolute z-10 max-w-[240px] rounded-[4px] border px-2.5 py-1.5 text-[10.5px]"
          style={{
            left: hover.x + 10,
            top: Math.max(0, hover.y - 32),
            background: 'var(--scope-2)',
            borderColor: 'var(--grat)',
            color: 'var(--ink-2)',
          }}
        >
          {hover.day.date} &middot; {DOMAIN_LABELS[hover.domain]} &middot;{' '}
          <span style={{ color: 'var(--ink)' }}>{hover.day.byDomain[hover.domain] ?? 0} stories</span>
        </div>
      )}
    </div>
  );
}
