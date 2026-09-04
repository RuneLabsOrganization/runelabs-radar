// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';

export interface TrendBar {
  v: number;
  /** accent-colored full bar — the latest COMPLETE day */
  accent: boolean;
  /** trailing partial-today bucket: hatched/attenuated, never accented */
  partial: boolean;
}

/**
 * Per-bar presentation for a zero-filled daily series (oldest first). When
 * `partialLast` is set, the trailing bucket is today's still-filling UTC day:
 * it must never take the accent (a half-full bar reading as "the decline"),
 * so the accent falls back to the latest complete day. Pure — exported for
 * tests.
 */
export function trendBars(values: number[], partialLast = false): TrendBar[] {
  const last = values.length - 1;
  const accentIdx = partialLast ? last - 1 : last;
  return values.map((v, i) => ({
    v,
    accent: i === accentIdx,
    partial: partialLast && i === last,
  }));
}

/**
 * Right-rail micro chart: one bar per day, latest complete bar accented — the
 * graphic form of "went from 1 to 16". A trailing partial-today bar renders
 * hatched (still filling up), never as the accent. Renders nothing for
 * empty/flat-zero series.
 */
export default function MiniTrend({
  values,
  color = 'var(--phosphor)',
  width = 104,
  height = 30,
  caption,
  fluid = false,
  partialLast = false,
}: {
  values: number[] | null;
  color?: string;
  width?: number;
  height?: number;
  caption?: string;
  /** fill the container width instead of a fixed pixel width (bar widths stretch) */
  fluid?: boolean;
  /** the last bar is today's partial UTC bucket — hatch it, accent the day before */
  partialLast?: boolean;
}) {
  // deterministic id (no hooks — MiniTrend renders inside server components):
  // same color ⇒ same pattern content, so duplicate ids dedupe harmlessly
  const hatchId = `mt-hatch-${color.replace(/[^a-z0-9]/gi, '')}`;
  if (!values || values.length === 0 || values.every((v) => v === 0)) return null;
  const bars = trendBars(values, partialLast);
  const max = Math.max(...values);
  const gap = 2;
  const bw = (width - gap * (values.length - 1)) / values.length;

  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5">
      <svg
        {...(fluid
          ? { className: 'block w-full', preserveAspectRatio: 'none' }
          : { width })}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={
          caption
            ? `${caption}: ${values.join(', ')}${partialLast ? ' (today partial)' : ''}`
            : `trend: ${values.join(', ')}${partialLast ? ' (today partial)' : ''}`
        }
      >
        {partialLast && (
          <defs>
            <pattern
              id={hatchId}
              width={3}
              height={3}
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <rect width={3} height={3} fill="var(--grat-strong)" opacity={0.3} />
              <line x1={0} y1={0} x2={0} y2={3} stroke={color} strokeWidth={1} opacity={0.7} />
            </pattern>
          </defs>
        )}
        {bars.map((bar, i) => {
          const h = Math.max(1.5, (bar.v / max) * (height - 2));
          return (
            <rect
              key={i}
              x={i * (bw + gap)}
              y={height - h}
              width={bw}
              height={h}
              rx={1}
              fill={bar.partial ? `url(#${hatchId})` : bar.accent ? color : 'var(--grat-strong)'}
              opacity={bar.partial ? 0.9 : bar.accent ? 0.95 : 0.8}
            />
          );
        })}
      </svg>
      {caption && (
        <span className="mono text-[10px] tracking-[0.06em] uppercase" style={{ color: 'var(--ink-4)' }}>
          {caption}
        </span>
      )}
    </div>
  );
}
