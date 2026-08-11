'use client';

import * as React from 'react';
import { useState } from 'react';
import type { Forecast } from '@/lib/science/forecast';
import { fmtUsd } from '@/lib/costs';

const W = 640;
const H = 220;
const PAD = { top: 10, right: 14, bottom: 22, left: 40 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

/**
 * Price of frontier intelligence: history (solid), log-linear projection
 * (dashed) with an uncertainty band that widens with distance from data.
 * Honest warming-up state until enough snapshot days exist.
 */
export default function ForecastChart({ forecast }: { forecast: Forecast }) {
  const [hover, setHover] = useState<{ x: number; label: string; value: string } | null>(null);
  const { history, projection, fit, daysOfHistory } = forecast;
  if (history.length === 0) {
    return (
      <p className="mono py-3 text-[12px]" style={{ color: 'var(--ink-4)' }}>
        No frontier price history yet — the daily snapshot job begins the series.
      </p>
    );
  }

  const allDates = [...history.map((p) => p.date), ...projection.map((p) => p.date)];
  const t0 = Date.parse(allDates[0]);
  const t1 = Math.max(Date.parse(allDates[allDates.length - 1]), t0 + 864e5);
  const maxY = Math.max(...history.map((p) => p.value), ...projection.map((p) => p.hi), 0.001) * 1.15;
  const x = (date: string) => PAD.left + ((Date.parse(date) - t0) / (t1 - t0)) * PLOT_W;
  const y = (v: number) => PAD.top + PLOT_H - (v / maxY) * PLOT_H;

  const yTicks = [0, maxY / 2, maxY];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label="Cheapest frontier-intelligence price over time with projection"
        onMouseLeave={() => setHover(null)}
      >
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={y(t)} y2={y(t)} stroke="var(--grat-soft)" />
            <text x={PAD.left - 5} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)">
              {fmtUsd(t)}
            </text>
          </g>
        ))}
        {[history[0].date, history[history.length - 1].date, ...(projection.length ? [projection[projection.length - 1].date] : [])].map(
          (d, i) => (
            <text
              key={`${d}-${i}`}
              x={x(d)}
              y={H - 6}
              textAnchor={i === 0 ? 'start' : 'end'}
              fontSize={10}
              fill="var(--ink-4)"
              fontFamily="var(--font-readout)"
            >
              {d.slice(5)}
            </text>
          ),
        )}

        {/* uncertainty band */}
        {projection.length > 1 && (
          <polygon
            points={[
              ...projection.map((p) => `${x(p.date)},${y(p.hi)}`),
              ...[...projection].reverse().map((p) => `${x(p.date)},${y(p.lo)}`),
            ].join(' ')}
            fill="var(--phosphor-dim)"
          />
        )}

        {/* history */}
        <polyline
          points={history.map((p) => `${x(p.date)},${y(p.value)}`).join(' ')}
          fill="none"
          stroke="var(--phosphor)"
          strokeWidth={1.5}
        />
        {history.map((p) => (
          <circle
            key={p.date}
            cx={x(p.date)}
            cy={y(p.value)}
            r={3}
            fill="var(--phosphor)"
            onMouseEnter={() => setHover({ x: x(p.date), label: p.date, value: fmtUsd(p.value) })}
          />
        ))}

        {/* projection mid */}
        {projection.length > 1 && (
          <polyline
            points={projection.map((p) => `${x(p.date)},${y(p.mid)}`).join(' ')}
            fill="none"
            stroke="var(--phosphor)"
            strokeWidth={1.2}
            strokeDasharray="4 4"
            opacity={0.7}
          />
        )}
      </svg>

      {hover && (
        <div
          className="mono pointer-events-none absolute top-2 z-10 rounded-[4px] border px-2.5 py-1.5 text-[10.5px]"
          style={{
            left: `${Math.min(80, Math.max(6, (hover.x / W) * 100))}%`,
            transform: 'translateX(-50%)',
            background: 'var(--scope-2)',
            borderColor: 'var(--grat)',
            color: 'var(--ink-2)',
          }}
        >
          <div style={{ color: 'var(--ink-3)' }}>{hover.label}</div>
          <div style={{ color: 'var(--ink)' }}>{hover.value} / 1M blended</div>
        </div>
      )}

      <p className="mono mt-1.5 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        cheapest model within 90% of the day&apos;s intelligence ceiling
        {projection.length > 0 && fit ? (
          <>
            {' '}
            &middot; log-linear projection, 30d &middot; r&sup2; {fit.r2.toFixed(2)} &middot; band widens with
            distance from data
          </>
        ) : (
          <span style={{ color: 'var(--amber)' }}>
            {' '}
            &middot; warming up — projection unlocks at 5 snapshot days ({daysOfHistory} so far)
          </span>
        )}
      </p>
    </div>
  );
}
