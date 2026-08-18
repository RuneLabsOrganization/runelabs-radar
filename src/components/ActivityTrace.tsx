'use client';

import * as React from 'react';
import { useMemo, useState } from 'react';
import { DOMAINS, DOMAIN_COLORS, DOMAIN_LABELS, isDomain, type Domain } from '@/lib/domains';
import type { DayCount } from '@/lib/analytics';

const W = 640;
const H = 180;
const PAD = { top: 8, right: 8, bottom: 18, left: 26 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

/**
 * 14-day sector activity trace — phosphor lines on a graticule. Click legend
 * ticks to isolate sectors; hover for the per-day readout. Weekends are
 * shaded; sector-spike detections ("machine noticed") mark the day they fired.
 */
export default function ActivityTrace({
  days,
  focus,
  spikes,
}: {
  days: DayCount[];
  focus?: Domain;
  /** sector-spike detections: the day the spike happened + which sector */
  spikes?: { date: string; domain: string }[];
}) {
  const [hidden, setHidden] = useState<Set<Domain>>(
    () => new Set(focus ? DOMAINS.filter((d) => d !== focus) : []),
  );
  const [hoverI, setHoverI] = useState<number | null>(null);
  // draw-in on first scroll into view (instant under reduced motion)
  const [drawn, setDrawn] = useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDrawn(true);
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setDrawn(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const maxY = useMemo(() => Math.max(1, ...days.map((d) => d.total)), [days]);
  const x = (i: number) => PAD.left + (days.length <= 1 ? 0 : (i / (days.length - 1)) * PLOT_W);
  const y = (v: number) => PAD.top + PLOT_H - (v / maxY) * PLOT_H;

  const totalArea = useMemo(() => {
    if (days.length === 0) return '';
    const pts = days.map((d, i) => `${x(i)},${y(d.total)}`).join(' ');
    return `${PAD.left},${PAD.top + PLOT_H} ${pts} ${PAD.left + PLOT_W},${PAD.top + PLOT_H}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, maxY]);

  function toggle(d: Domain) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const rel = (px - PAD.left) / PLOT_W;
    const i = Math.round(rel * (days.length - 1));
    setHoverI(i >= 0 && i < days.length ? i : null);
  }

  const hover = hoverI !== null ? days[hoverI] : null;
  const yTicks = [0, Math.ceil(maxY / 2), maxY];

  return (
    <div className="relative" ref={rootRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label="Curated story volume per day, split by sector"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverI(null)}
      >
        {/* weekend shading — Sat/Sun bands behind everything */}
        {days.map((d, i) => {
          const dow = new Date(`${d.date}T00:00:00Z`).getUTCDay();
          if (dow !== 0 && dow !== 6) return null;
          const half = days.length > 1 ? PLOT_W / (days.length - 1) / 2 : PLOT_W / 2;
          return (
            <rect
              key={`wk-${d.date}`}
              x={Math.max(PAD.left, x(i) - half)}
              y={PAD.top}
              width={Math.min(half * 2, PAD.left + PLOT_W - Math.max(PAD.left, x(i) - half))}
              height={PLOT_H}
              fill="var(--grat-soft)"
              opacity={0.5}
            />
          );
        })}

        {/* graticule */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--grat-soft)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 5}
              y={y(t) + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--ink-4)"
              fontFamily="var(--font-readout)"
            >
              {t}
            </text>
          </g>
        ))}
        {days.map((d, i) =>
          i % 2 === 0 ? (
            <line
              key={d.date}
              x1={x(i)}
              x2={x(i)}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              stroke="var(--grat-soft)"
              strokeWidth={0.5}
            />
          ) : null,
        )}
        {[0, Math.floor((days.length - 1) / 2), days.length - 1]
          .filter((i, idx, arr) => days[i] && arr.indexOf(i) === idx)
          .map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 4}
              textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}
              fontSize={10}
              fill="var(--ink-4)"
              fontFamily="var(--font-readout)"
            >
              {days[i].date.slice(5)}
            </text>
          ))}

        {/* total volume as context area */}
        <polygon
          points={totalArea}
          fill="var(--grat-soft)"
          style={{ opacity: drawn ? 1 : 0, transition: 'opacity 500ms ease 450ms' }}
        />

        {/* sector traces */}
        {DOMAINS.filter((d) => !hidden.has(d)).map((d, di) => (
          <polyline
            key={d}
            points={days.map((day, i) => `${x(i)},${y(day.byDomain[d])}`).join(' ')}
            fill="none"
            stroke={DOMAIN_COLORS[d]}
            strokeWidth={1.5}
            strokeLinejoin="round"
            opacity={0.9}
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={drawn ? 0 : 1}
            style={{
              transition: `stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1) ${di * 90}ms`,
            }}
          />
        ))}

        {/* anomaly markers — where the machine noticed a sector spike */}
        {(spikes ?? []).map((s, idx) => {
          if (!isDomain(s.domain)) return null;
          const di = days.findIndex((d) => d.date === s.date);
          if (di === -1 || hidden.has(s.domain)) return null;
          const cx = x(di);
          const cy = y(days[di].byDomain[s.domain]);
          return (
            <g key={`spike-${idx}`}>
              <rect
                x={cx - 3.4}
                y={cy - 3.4}
                width={6.8}
                height={6.8}
                transform={`rotate(45 ${cx} ${cy})`}
                fill="var(--scope-0)"
                stroke="var(--phosphor)"
                strokeWidth={1.2}
              />
              <title>{`${DOMAIN_LABELS[s.domain]} spike — machine noticed`}</title>
            </g>
          );
        })}

        {/* hover crosshair */}
        {hoverI !== null && (
          <line
            x1={x(hoverI)}
            x2={x(hoverI)}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            stroke="var(--grat-strong)"
            strokeWidth={1}
          />
        )}
      </svg>

      {hover && hoverI !== null && (
        <div
          className="mono pointer-events-none absolute top-1 z-10 rounded-[4px] border px-2.5 py-1.5 text-[10.5px]"
          style={{
            left: `${Math.min(82, Math.max(2, (x(hoverI) / W) * 100))}%`,
            transform: 'translateX(-50%)',
            background: 'var(--scope-2)',
            borderColor: 'var(--grat)',
            color: 'var(--ink-2)',
          }}
        >
          <div style={{ color: 'var(--ink-3)' }}>{hover.date}</div>
          <div style={{ color: 'var(--ink)' }}>{hover.total} stories</div>
          {DOMAINS.filter((d) => !hidden.has(d) && hover.byDomain[d] > 0)
            .sort((a, b) => hover.byDomain[b] - hover.byDomain[a])
            .map((d) => (
              <div key={d} className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-[7px] w-[2px]" style={{ background: DOMAIN_COLORS[d] }} />
                {DOMAIN_LABELS[d].toUpperCase()} {hover.byDomain[d]}
              </div>
            ))}
        </div>
      )}

      {/* legend / toggles */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {DOMAINS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => toggle(d)}
            aria-pressed={!hidden.has(d)}
            className="mono inline-flex cursor-pointer items-center gap-[5px] border-0 bg-transparent p-0 text-[10px] tracking-[0.06em] transition-opacity"
            style={{ color: 'var(--ink-3)', opacity: hidden.has(d) ? 0.35 : 1 }}
          >
            <span aria-hidden className="inline-block h-[9px] w-[2px]" style={{ background: DOMAIN_COLORS[d] }} />
            {DOMAIN_LABELS[d].toUpperCase()}
          </button>
        ))}
        <span className="mono ml-auto text-[10px]" style={{ color: 'var(--ink-4)' }}>
          area = total volume
        </span>
      </div>
    </div>
  );
}
