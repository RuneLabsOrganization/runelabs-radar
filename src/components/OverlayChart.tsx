/**
 * Multi-series overlay SVG. One series: true values on the y-axis. More than
 * one: each series min-max scaled to its own range (shapes comparable,
 * absolute values are not — say so under the chart).
 */
export interface OverlaySeries {
  source: string;
  entity: string;
  metric: string;
  points: { date: string; value: number }[];
}

const COLORS = ['var(--phosphor)', 'var(--amber)', 'var(--d-image)', 'var(--d-coding)', 'var(--alert)', 'var(--d-agentic)'];

function fmtVal(v: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
}

export default function OverlayChart({ series }: { series: OverlaySeries[] }) {
  const W = 640;
  const H = 240;
  const PAD = { top: 12, right: 14, bottom: 24, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  if (dates.length === 0) {
    return (
      <p className="mono py-3 text-[12px] text-ink-4">
        No points in this range — widen the window or pick another series.
      </p>
    );
  }
  const t0 = Date.parse(dates[0]);
  const t1 = Math.max(Date.parse(dates[dates.length - 1]), t0 + 864e5);
  const normalize = series.length > 1;
  const scales = series.map((s) => {
    const vals = s.points.map((p) => p.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { min, span: max - min };
  });
  const yMax = normalize ? 1 : Math.max(...series[0].points.map((p) => p.value), 0.001) * 1.15;

  const x = (date: string) => PAD.left + ((Date.parse(date) - t0) / (t1 - t0)) * plotW;
  const yFor = (i: number) => (v: number) => {
    if (normalize) {
      const { min, span } = scales[i];
      const frac = span === 0 ? 0.5 : (v - min) / span;
      return PAD.top + (1 - frac) * plotH;
    }
    return PAD.top + plotH - (v / yMax) * plotH;
  };

  const yTicks: { at: number; label: string }[] = normalize
    ? [
        { at: 0, label: 'min' },
        { at: 0.5, label: '' },
        { at: 1, label: 'max' },
      ]
    : [
        { at: 0, label: '0' },
        { at: yMax / 2, label: fmtVal(yMax / 2) },
        { at: yMax, label: fmtVal(yMax) },
      ];
  const yTick = (t: number) => (normalize ? PAD.top + (1 - t) * plotH : PAD.top + plotH - (t / yMax) * plotH);

  return (
    <div>
      <div className="mono mb-1 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-ink-3">
        {series.map((s, i) => (
          <span key={`${s.source}/${s.entity}/${s.metric}`} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-[7px] w-[7px] rounded-[2px]" style={{ background: COLORS[i % COLORS.length] }} />
            {s.entity} · {s.metric}
            <span className="text-ink-4">
              {s.points.length > 0 ? `last ${fmtVal(s.points[s.points.length - 1].value)}` : 'no points'}
            </span>
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={`Overlay of ${series.map((s) => `${s.entity} ${s.metric}`).join(', ')}`}
      >
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yTick(t.at)} y2={yTick(t.at)} stroke="var(--grat-soft)" />
            {t.label && (
              <text x={PAD.left - 5} y={yTick(t.at) + 3} textAnchor="end" fontSize={10} fill="var(--ink-4)" fontFamily="var(--font-readout)">
                {t.label}
              </text>
            )}
          </g>
        ))}
        {[dates[0], dates[dates.length - 1]].map((d, i) => (
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
        ))}
        {series.map((s, i) =>
          s.points.length > 1 ? (
            <polyline
              key={`${s.source}/${s.entity}/${s.metric}`}
              points={s.points.map((p) => `${x(p.date)},${yFor(i)(p.value)}`).join(' ')}
              fill="none"
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={1.5}
            />
          ) : (
            s.points.map((p) => (
              <circle key={`${s.source}/${s.entity}/${s.metric}/${p.date}`} cx={x(p.date)} cy={yFor(i)(p.value)} r={3} fill={COLORS[i % COLORS.length]} />
            ))
          ),
        )}
      </svg>
    </div>
  );
}
