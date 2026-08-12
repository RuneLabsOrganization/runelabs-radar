// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';

/**
 * Right-rail micro chart: one bar per day, latest bar accented — the graphic
 * form of "went from 1 to 16". Renders nothing for empty/flat-zero series.
 */
export default function MiniTrend({
  values,
  color = 'var(--phosphor)',
  width = 104,
  height = 30,
  caption,
  fluid = false,
}: {
  values: number[] | null;
  color?: string;
  width?: number;
  height?: number;
  caption?: string;
  /** fill the container width instead of a fixed pixel width (bar widths stretch) */
  fluid?: boolean;
}) {
  if (!values || values.length === 0 || values.every((v) => v === 0)) return null;
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
        aria-label={caption ? `${caption}: ${values.join(', ')}` : `trend: ${values.join(', ')}`}
      >
        {values.map((v, i) => {
          const h = Math.max(1.5, (v / max) * (height - 2));
          const last = i === values.length - 1;
          return (
            <rect
              key={i}
              x={i * (bw + gap)}
              y={height - h}
              width={bw}
              height={h}
              rx={1}
              fill={last ? color : 'var(--grat-strong)'}
              opacity={last ? 0.95 : 0.8}
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
