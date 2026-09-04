'use client';

import * as React from 'react';
import { useMemo, useState } from 'react';
import { paretoFrontier, type AaModel } from '@/lib/pareto';
import { fmtUsdCompact } from '@/lib/format';

/** Hover-label price: shared compact USD, never a raw float like "$0.37000000000000005/1M". */
export function scatterPriceLabel(price: number): string {
  return `${fmtUsdCompact(price)}/1M`;
}

const W = 640;
const H = 260;
const PAD = { top: 10, right: 14, bottom: 26, left: 30 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const X_TICKS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];

type Metric = 'intelligence' | 'coding' | 'speed';

const METRIC_Y: Record<Metric, (m: AaModel) => number | null> = {
  intelligence: (m) => m.intelligence,
  coding: (m) => m.coding,
  speed: (m) => m.speed,
};

/** Per-day series for the time-lapse: dates oldest→newest, values carry-forward filled. */
export interface ScatterHistory {
  dates: string[];
  intel: Record<string, (number | null)[]>;
  price: Record<string, (number | null)[]>;
}

/**
 * Quality vs price scatter from the Artificial Analysis snapshot — log-price
 * x-axis, Pareto-frontier models phosphor-lit and labeled. When `history` is
 * provided, a play button animates the market over the covered days.
 */
export default function ModelScatter({
  models,
  fetchedAt,
  history,
}: {
  models: AaModel[];
  fetchedAt: string;
  history?: ScatterHistory;
}) {
  const [metric, setMetric] = useState<Metric>('intelligence');
  const [hover, setHover] = useState<number | null>(null);
  const [playIdx, setPlayIdx] = useState<number | null>(null); // null = live snapshot

  React.useEffect(() => {
    if (playIdx === null || !history) return;
    const t = setInterval(() => {
      setPlayIdx((i) => (i === null ? null : i + 1 >= history.dates.length ? null : i + 1));
    }, 600);
    return () => clearInterval(t);
  }, [playIdx !== null, history]);

  // effective per-model values: live snapshot, or the animated day
  const eff = useMemo(() => {
    if (playIdx === null || !history) return models.map((m) => ({ m, y: METRIC_Y[metric](m), price: m.price }));
    const { dates, intel, price } = history;
    const out: { m: AaModel; y: number | null; price: number }[] = [];
    for (const m of models) {
      const is = intel[m.name];
      const ps = price[m.name];
      if (!is || !ps) continue;
      // carry-forward: last known value up to playIdx
      let y: number | null = null;
      let p: number | null = null;
      for (let d = 0; d <= playIdx && d < dates.length; d++) {
        if (is[d] !== null) y = is[d];
        if (ps[d] !== null) p = ps[d];
      }
      if (y !== null && p !== null && p > 0) out.push({ m, y, price: p });
    }
    return out;
  }, [models, metric, playIdx, history]);

  const pts = useMemo(() => {
    return eff
      .filter((p): p is { m: AaModel; y: number; price: number } => p.y !== null && p.y > 0);
  }, [eff]);

  const { xOf, yOf, frontier, maxY } = useMemo(() => {
    const prices = pts.map((p) => p.price);
    const minP = Math.max(0.01, Math.min(...prices));
    const maxP = Math.max(...prices);
    const logMin = Math.log10(minP);
    const logMax = Math.log10(maxP);
    const span = Math.max(0.001, logMax - logMin);
    const top = Math.max(...pts.map((p) => p.y)) * 1.08;
    const xOf = (price: number) => PAD.left + ((Math.log10(price) - logMin) / span) * PLOT_W;
    const yOf = (v: number) => PAD.top + PLOT_H - (v / top) * PLOT_H;
    const frontier = paretoFrontier(pts.map((p) => ({ x: p.price, y: p.y })));
    return { xOf, yOf, frontier, maxY: top };
  }, [pts]);

  if (pts.length === 0) return null;
  const hovered = hover !== null ? pts[hover] : null;
  const yTicks = [0, Math.round(maxY / 2), Math.round(maxY)];

  return (
    <div className="relative">
      <div className="mono mb-2 flex items-center gap-2 text-[10px] tracking-[0.08em]">
        {(['intelligence', 'coding', 'speed'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMetric(m);
              setHover(null);
              setPlayIdx(null); // history is intelligence-only — stop playback under the new label
            }}
            aria-pressed={metric === m}
            className={`cursor-pointer rounded-[3px] border px-2 py-0.5 uppercase transition-colors ${
              metric === m
                ? 'border-[var(--phosphor)] text-[var(--ink)]'
                : 'border-[var(--grat)] text-[var(--ink-3)] hover:border-[var(--grat-strong)]'
            }`}
          >
            {m}
          </button>
        ))}
        <span className="ml-auto" style={{ color: 'var(--ink-4)' }}>
          {metric === 'speed' ? 'median tok/s' : 'index'} vs $/1M tokens (blended, log)
        </span>
        {history && history.dates.length >= 5 && metric === 'intelligence' && (
          <button
            type="button"
            onClick={() => setPlayIdx(playIdx === null ? 0 : null)}
            aria-pressed={playIdx !== null}
            className={`cursor-pointer rounded-[3px] border px-2 py-0.5 uppercase transition-colors ${
              playIdx !== null
                ? 'border-[var(--phosphor)] text-[var(--phosphor)]'
                : 'border-[var(--grat)] text-[var(--ink-3)] hover:border-[var(--grat-strong)]'
            }`}
          >
            {playIdx !== null ? '◼ stop' : '▶ 30d'}
          </button>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={`Model ${metric} index versus blended price`}
        onMouseLeave={() => setHover(null)}
      >
        {/* quadrant labels — orientation at a glance */}
        <text x={PAD.left + 6} y={PAD.top + 11} fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)" opacity={0.9}>
          cheap + smart
        </text>
        <text x={PAD.left + PLOT_W - 6} y={PAD.top + 11} textAnchor="end" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)" opacity={0.9}>
          premium
        </text>
        <text x={PAD.left + 6} y={PAD.top + PLOT_H - 6} fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)" opacity={0.7}>
          budget
        </text>
        <text x={PAD.left + PLOT_W - 6} y={PAD.top + PLOT_H - 6} textAnchor="end" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)" opacity={0.7}>
          avoid
        </text>

        {/* playback date stamp */}
        {playIdx !== null && history && (
          <text x={PAD.left + PLOT_W / 2} y={PAD.top + 11} textAnchor="middle" fontSize={11} fill="var(--phosphor)" fontFamily="var(--font-readout)">
            {history.dates[playIdx]}
          </text>
        )}

        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={yOf(t)} y2={yOf(t)} stroke="var(--grat-soft)" />
            <text x={PAD.left - 5} y={yOf(t) + 3} textAnchor="end" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)">
              {t}
            </text>
          </g>
        ))}
        {X_TICKS.filter((t) => {
          const x = xOf(t);
          return x >= PAD.left - 1 && x <= PAD.left + PLOT_W + 1;
        }).map((t) => (
          <g key={`x${t}`}>
            <line x1={xOf(t)} x2={xOf(t)} y1={PAD.top} y2={PAD.top + PLOT_H} stroke="var(--grat-soft)" strokeWidth={0.5} />
            <text x={xOf(t)} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)">
              ${t}
            </text>
          </g>
        ))}

        {/* frontier connective trace */}
        <polyline
          points={pts
            .map((p, i) => ({ p, i }))
            .filter(({ i }) => frontier[i])
            .sort((a, b) => a.p.price - b.p.price)
            .map(({ p }) => `${xOf(p.price)},${yOf(p.y)}`)
            .join(' ')}
          fill="none"
          stroke="var(--phosphor)"
          strokeWidth={1}
          opacity={0.35}
        />

        {pts.map((p, i) => (
          <g key={`${p.m.name}-${i}`}>
            <circle
              cx={xOf(p.price)}
              cy={yOf(p.y)}
              r={hover === i ? 4.5 : frontier[i] ? 3.5 : 2.5}
              fill={frontier[i] ? 'var(--phosphor)' : 'var(--grat-strong)'}
              opacity={frontier[i] ? 0.95 : 0.8}
              style={playIdx !== null ? { transition: 'cx 450ms linear, cy 450ms linear' } : undefined}
            />
            {/* generous invisible hit area */}
            <circle
              cx={xOf(p.price)}
              cy={yOf(p.y)}
              r={9}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
            {frontier[i] && hover !== i && (
              <text
                x={xOf(p.price) + 6}
                // alternate above/below so clustered frontier labels don't collide
                y={yOf(p.y) + (pts.slice(0, i).filter((_, j) => frontier[j]).length % 2 === 0 ? -6 : 12)}
                fontSize={9.5}
                fill="var(--ink-3)"
                fontFamily="var(--font-readout)"
              >
                {p.m.name.length > 24 ? `${p.m.name.slice(0, 23)}…` : p.m.name}
              </text>
            )}
          </g>
        ))}
      </svg>

      {hovered && (
        <div
          className="mono pointer-events-none absolute z-10 rounded-[4px] border px-2.5 py-1.5 text-[10.5px]"
          style={{
            left: `${Math.min(78, Math.max(4, (xOf(hovered.price) / W) * 100))}%`,
            top: 24,
            transform: 'translateX(-50%)',
            background: 'var(--scope-2)',
            borderColor: 'var(--grat)',
            color: 'var(--ink-2)',
          }}
        >
          <div style={{ color: 'var(--ink)' }}>{hovered.m.name}</div>
          {hovered.m.org && <div style={{ color: 'var(--ink-3)' }}>{hovered.m.org}</div>}
          <div>
            {metric === 'speed' ? `${Math.round(hovered.y)} tok/s` : `${metric} ${hovered.y}`} &middot;{' '}
            {scatterPriceLabel(hovered.price)}
          </div>
          {metric !== 'speed' && hovered.m.speed !== null && <div>{Math.round(hovered.m.speed)} tok/s</div>}
          {metric === 'speed' && <div>intel {hovered.m.intelligence}</div>}
        </div>
      )}

      <div className="mono mt-1.5 flex items-center gap-3 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        <span>
          <span aria-hidden style={{ color: 'var(--phosphor)' }}>
            &#9679;
          </span>{' '}
          pareto frontier
        </span>
        <a
          href="https://artificialanalysis.ai"
          target="_blank"
          rel="noreferrer"
          className="ml-auto hover:underline"
        >
          data: Artificial Analysis
        </a>
        <span>&middot; {fetchedAt}</span>
      </div>
    </div>
  );
}
