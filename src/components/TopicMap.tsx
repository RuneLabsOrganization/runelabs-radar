'use client';

import * as React from 'react';
import { useState } from 'react';
import type { TopicMapCluster, TopicMapPoint } from '@/lib/analytics';

const W = 640;
const H = 340;
const PAD = 26;

/**
 * The semantic terrain, 2D preview of the Phase-4 starfield: every story
 * placed by embedding PCA, clusters labeled at their centers, brightness =
 * cluster heat. Hover a point for its story.
 */
export default function TopicMap({
  clusters,
  points,
}: {
  clusters: TopicMapCluster[];
  points: TopicMapPoint[];
}) {
  const [hover, setHover] = useState<number | null>(null);

  // coords arrive in [-1, 1] — map into the plot with padding
  const px = (x: number) => PAD + ((x + 1) / 2) * (W - PAD * 2);
  const py = (y: number) => PAD + ((1 - (y + 1) / 2)) * (H - PAD * 2);
  const heatOf = new Map(clusters.map((c) => [c.id, c.heat]));
  const hovered = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label="Semantic map of recent stories, clustered by topic"
        onMouseLeave={() => setHover(null)}
      >
        {/* graticule frame */}
        <rect x={1} y={1} width={W - 2} height={H - 2} fill="none" stroke="var(--grat-soft)" />
        <line x1={W / 2} x2={W / 2} y1={4} y2={H - 4} stroke="var(--grat-soft)" strokeWidth={0.5} />
        <line x1={4} x2={W - 4} y1={H / 2} y2={H / 2} stroke="var(--grat-soft)" strokeWidth={0.5} />

        {points.map((p, i) => (
          <g key={p.id}>
            <circle
              cx={px(p.x)}
              cy={py(p.y)}
              r={hover === i ? 4.5 : p.score >= 70 ? 3 : 2.2}
              fill="var(--phosphor)"
              opacity={0.3 + (heatOf.get(p.clusterId) ?? 0) * 0.55}
            />
            <circle cx={px(p.x)} cy={py(p.y)} r={8} fill="transparent" onMouseEnter={() => setHover(i)} />
          </g>
        ))}

        {clusters.map((c) => (
          <text
            key={c.id}
            x={px(c.x)}
            y={py(c.y) - 8}
            textAnchor="middle"
            fontSize={9.5}
            fontFamily="var(--font-readout)"
            fill={c.heat > 0.7 ? 'var(--ink)' : 'var(--ink-3)'}
            style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}
          >
            {c.label}
          </text>
        ))}
      </svg>

      {hovered && (
        <div
          className="mono pointer-events-none absolute z-10 max-w-[320px] rounded-[4px] border px-2.5 py-1.5 text-[10.5px]"
          style={{
            left: `${Math.min(70, Math.max(4, (px(hovered.x) / W) * 100))}%`,
            top: 8,
            transform: 'translateX(-50%)',
            background: 'var(--scope-2)',
            borderColor: 'var(--grat)',
            color: 'var(--ink-2)',
          }}
        >
          <div style={{ color: 'var(--ink)' }}>{hovered.title}</div>
          <div style={{ color: 'var(--ink-3)' }}>
            {clusters.find((c) => c.id === hovered.clusterId)?.label ?? ''} &middot; signal {hovered.score}
          </div>
        </div>
      )}

      <p className="mono mt-1.5 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        PCA projection of story embeddings &middot; 14d window &middot; brightness = topic heat &middot;
        larger dots = top signals
      </p>
    </div>
  );
}
