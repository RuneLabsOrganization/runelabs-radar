'use client';

import * as React from 'react';
import { useEffect, useId, useState } from 'react';
import type { SubScores } from '@/lib/opportunities/engine';

/** Simply-Wall-St rule: the fill COLOR is the verdict; the shape is the detail. */
export function gradeColor(score: number): string {
  return score >= 70 ? 'var(--phosphor)' : score >= 45 ? 'var(--amber)' : 'var(--alert)';
}

/** The eight axes whose SHAPE tells the launch story at a glance. */
const RADAR_AXES: { key: keyof SubScores; label: string }[] = [
  { key: 'demand', label: 'demand' },
  { key: 'buildability', label: 'build' },
  { key: 'margin', label: 'margin' },
  { key: 'moat', label: 'moat' },
  { key: 'competition', label: 'open field' },
  { key: 'distribution', label: 'reach' },
  { key: 'regClear', label: 'reg clear' },
  { key: 'platformSafe', label: 'platform' },
];

const SIZE = 216;
const C = SIZE / 2;
const R = SIZE / 2 - 34; // room for labels

function pos(axisIdx: number, value: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (axisIdx / RADAR_AXES.length) * Math.PI * 2;
  const r = (value / 20) * R;
  return { x: C + Math.cos(angle) * r, y: C + Math.sin(angle) * r };
}

/**
 * 8-axis launch radar, snowflake-graded: the polygon's fill color carries the
 * verdict (phosphor = go, amber = maybe, alert = pass) while the shape shows
 * where the tradeoffs live. Hover an axis for the exact score.
 */
export default function SpiderChart({ sub, grade }: { sub: SubScores; grade?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const gradId = useId();
  const color = grade !== undefined ? gradeColor(grade) : 'var(--phosphor)';
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMounted(true);
      return;
    }
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const ringPoints = (v: number) =>
    RADAR_AXES.map((_, i) => {
      const p = pos(i, v);
      return `${p.x},${p.y}`;
    }).join(' ');

  const valuePoints = RADAR_AXES.map((a, i) => {
    const p = pos(i, sub[a.key] ?? 0);
    return `${p.x},${p.y}`;
  }).join(' ');

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SIZE - C;
    const y = ((e.clientY - rect.top) / rect.height) * SIZE - C;
    if (Math.hypot(x, y) < 8) {
      setHover(null);
      return;
    }
    let angle = Math.atan2(y, x) + Math.PI / 2; // axis 0 at top
    if (angle < 0) angle += Math.PI * 2;
    setHover(Math.round((angle / (Math.PI * 2)) * RADAR_AXES.length) % RADAR_AXES.length);
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="block w-full"
        role="img"
        aria-label={`Launch assessment radar: ${RADAR_AXES.map((a) => `${a.label} ${sub[a.key] ?? 0} of 20`).join(', ')}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {[5, 10, 15, 20].map((v) => (
          <polygon key={v} points={ringPoints(v)} fill="none" stroke="var(--grat-soft)" strokeWidth={v === 20 ? 1 : 0.6} />
        ))}
        {RADAR_AXES.map((a, i) => {
          const tip = pos(i, 20);
          const labelP = pos(i, 26);
          const active = hover === i;
          return (
            <g key={a.key}>
              <line x1={C} y1={C} x2={tip.x} y2={tip.y} stroke={active ? 'var(--grat-strong)' : 'var(--grat-soft)'} strokeWidth={0.6} />
              <text
                x={labelP.x}
                y={labelP.y + 2.5}
                textAnchor="middle"
                fontSize={9}
                fontFamily="var(--font-readout)"
                fill={active ? 'var(--ink-2)' : 'var(--ink-4)'}
                style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}
              >
                {active ? `${a.label} ${sub[a.key] ?? 0}` : a.label}
              </text>
            </g>
          );
        })}
        <defs>
          <radialGradient id={gradId} cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor={color} stopOpacity={0.34} />
            <stop offset="70%" stopColor={color} stopOpacity={0.14} />
            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
          </radialGradient>
        </defs>
        <g
          style={{
            transformBox: 'fill-box',
            transformOrigin: 'center',
            transform: mounted ? 'scale(1)' : 'scale(0.25)',
            opacity: mounted ? 1 : 0,
            transition: 'transform 700ms cubic-bezier(0.22, 1, 0.36, 1), opacity 500ms ease',
          }}
        >
          {/* soft verdict glow */}
          <polygon points={valuePoints} fill="none" stroke={color} strokeWidth={5} strokeOpacity={0.1} strokeLinejoin="round" />
          <polygon points={valuePoints} fill={`url(#${gradId})`} stroke={color} strokeWidth={1.4} strokeOpacity={0.9} strokeLinejoin="round" />
          {RADAR_AXES.map((a, i) => {
            const p = pos(i, sub[a.key] ?? 0);
            return <circle key={a.key} cx={p.x} cy={p.y} r={hover === i ? 3 : 1.8} fill={color} />;
          })}
        </g>
      </svg>
    </div>
  );
}
