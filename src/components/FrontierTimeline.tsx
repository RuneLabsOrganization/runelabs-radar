'use client';

import * as React from 'react';
import { useMemo, useState } from 'react';
import type { AaModel } from '@/lib/pareto';

const W = 640;
const H = 230;
const PAD = { top: 10, right: 14, bottom: 24, left: 30 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function parseReleased(released: string): number | null {
  const iso = released.length === 7 ? `${released}-15` : released;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * The race: intelligence index over release date. The phosphor step line is
 * the running frontier — each step is the moment the ceiling moved. Price
 * rides in the tooltip (one axis; never two).
 */
export default function FrontierTimeline({ models }: { models: AaModel[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const pts = useMemo(() => {
    return models
      .map((m) => ({ m, t: m.released ? parseReleased(m.released) : null }))
      .filter((p): p is { m: AaModel; t: number } => p.t !== null)
      .sort((a, b) => a.t - b.t);
  }, [models]);

  const { xOf, yOf, frontierIdx, maxY } = useMemo(() => {
    const minT = pts[0]?.t ?? 0;
    const maxT = pts[pts.length - 1]?.t ?? 1;
    const span = Math.max(1, maxT - minT);
    const top = Math.max(...pts.map((p) => p.m.intelligence), 1) * 1.08;
    const xOf = (t: number) => PAD.left + ((t - minT) / span) * PLOT_W;
    const yOf = (v: number) => PAD.top + PLOT_H - (v / top) * PLOT_H;
    const frontierIdx = new Set<number>();
    let best = -Infinity;
    pts.forEach((p, i) => {
      if (p.m.intelligence > best) {
        best = p.m.intelligence;
        frontierIdx.add(i);
      }
    });
    return { xOf, yOf, frontierIdx, maxY: top };
  }, [pts]);

  if (pts.length < 3) return null;
  const hovered = hover !== null ? pts[hover] : null;
  const yTicks = [0, Math.round(maxY / 2), Math.round(maxY)];

  // quarter-ish x labels: first, middle, last release months
  const labelIdx = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];

  // frontier step path: horizontal-then-up steps between frontier points
  const frontierPts = pts.map((p, i) => ({ p, i })).filter(({ i }) => frontierIdx.has(i));
  let stepPath = '';
  frontierPts.forEach(({ p }, k) => {
    const x = xOf(p.t);
    const y = yOf(p.m.intelligence);
    if (k === 0) stepPath = `M ${x} ${y}`;
    else stepPath += ` H ${x} V ${y}`;
  });
  stepPath += ` H ${PAD.left + PLOT_W}`;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label="Model intelligence index by release date; step line is the running frontier"
        onMouseLeave={() => setHover(null)}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={yOf(t)} y2={yOf(t)} stroke="var(--grat-soft)" />
            <text x={PAD.left - 5} y={yOf(t) + 3} textAnchor="end" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)">
              {t}
            </text>
          </g>
        ))}
        {labelIdx.map((i) => (
          <text
            key={i}
            x={xOf(pts[i].t)}
            y={H - 8}
            textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}
            fontSize={10}
            fill="var(--ink-4)"
            fontFamily="var(--font-readout)"
          >
            {(pts[i].m.released ?? '').slice(0, 7)}
          </text>
        ))}

        <path d={stepPath} fill="none" stroke="var(--phosphor)" strokeWidth={1.2} opacity={0.55} />

        {pts.map((p, i) => (
          <g key={`${p.m.name}-${i}`}>
            <circle
              cx={xOf(p.t)}
              cy={yOf(p.m.intelligence)}
              r={hover === i ? 4.5 : frontierIdx.has(i) ? 3.5 : 2.5}
              fill={frontierIdx.has(i) ? 'var(--phosphor)' : 'var(--grat-strong)'}
              opacity={frontierIdx.has(i) ? 0.95 : 0.75}
            />
            <circle cx={xOf(p.t)} cy={yOf(p.m.intelligence)} r={9} fill="transparent" onMouseEnter={() => setHover(i)} />
            {frontierIdx.has(i) && hover !== i && (
              <text
                x={xOf(p.t) + 6}
                // alternate above/below so clustered frontier labels don't collide
                y={yOf(p.m.intelligence) + (pts.slice(0, i).filter((_, j) => frontierIdx.has(j)).length % 2 === 0 ? -6 : 12)}
                fontSize={9.5}
                fill="var(--ink-3)"
                fontFamily="var(--font-readout)"
              >
                {p.m.name.length > 22 ? `${p.m.name.slice(0, 21)}…` : p.m.name}
              </text>
            )}
          </g>
        ))}
      </svg>

      {hovered && (
        <div
          className="mono pointer-events-none absolute z-10 rounded-[4px] border px-2.5 py-1.5 text-[10.5px]"
          style={{
            left: `${Math.min(78, Math.max(4, (xOf(hovered.t) / W) * 100))}%`,
            top: 16,
            transform: 'translateX(-50%)',
            background: 'var(--scope-2)',
            borderColor: 'var(--grat)',
            color: 'var(--ink-2)',
          }}
        >
          <div style={{ color: 'var(--ink)' }}>{hovered.m.name}</div>
          {hovered.m.org && <div style={{ color: 'var(--ink-3)' }}>{hovered.m.org}</div>}
          <div>
            intel {hovered.m.intelligence} &middot; ${hovered.m.price}/1M &middot; {hovered.m.released}
          </div>
        </div>
      )}

      <p className="mono mt-1.5 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        <span aria-hidden style={{ color: 'var(--phosphor)' }}>&#9679;</span> frontier at release &middot;
        each step = the intelligence ceiling moving &middot; price in tooltip
      </p>
    </div>
  );
}
