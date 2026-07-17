'use client';

import * as React from 'react';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { TopicMapCluster, TopicMapPoint } from '@/lib/analytics';
import type { HoverInfo } from './StarfieldMap';

const StarfieldMap = dynamic(() => import('./StarfieldMap'), {
  ssr: false,
  loading: () => (
    <p className="mono p-6 text-[11px]" style={{ color: 'var(--phosphor)' }}>
      initializing starfield&hellip;
    </p>
  ),
});

/** Canvas + cluster rail: select a topic to isolate its region and list its stories. */
export default function MapExplorer({
  clusters,
  points,
}: {
  clusters: TopicMapCluster[];
  points: TopicMapPoint[];
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const byHeat = useMemo(() => [...clusters].sort((a, b) => b.heat - a.heat), [clusters]);
  const selectedCluster = clusters.find((c) => c.id === selected) ?? null;
  const memberStories = useMemo(
    () =>
      selected === null
        ? []
        : points
            .filter((p) => p.clusterId === selected)
            .sort((a, b) => b.score - a.score)
            .slice(0, 20),
    [points, selected],
  );

  return (
    <div className="flex h-[calc(100vh-9rem)] min-h-[480px] flex-col gap-4 lg:flex-row">
      <div className="relative min-h-[320px] flex-1 rounded-[6px] border border-[var(--grat-soft)] bg-[var(--scope-1)]">
        <StarfieldMap
          clusters={clusters}
          points={points}
          selected={selected}
          onSelect={setSelected}
          onHover={setHover}
        />
        {hover && (
          <div
            className="mono pointer-events-none absolute z-10 max-w-[300px] rounded-[4px] border px-2.5 py-1.5 text-[10.5px]"
            style={{
              left: Math.min(hover.x + 14, 9999),
              top: hover.y + 10,
              background: 'var(--scope-2)',
              borderColor: 'var(--grat)',
              color: 'var(--ink-2)',
            }}
          >
            <div style={{ color: 'var(--ink)' }}>{hover.title}</div>
            <div style={{ color: 'var(--ink-3)' }}>
              {hover.clusterLabel} &middot; signal {hover.score} &middot; {hover.ageDays}d ago
            </div>
          </div>
        )}
        <p
          className="mono pointer-events-none absolute bottom-2 left-3 text-[10px]"
          style={{ color: 'var(--ink-4)' }}
        >
          drag to orbit &middot; scroll to zoom &middot; click a story to open it &middot; depth = age
        </p>
      </div>

      <aside className="w-full shrink-0 overflow-y-auto lg:w-[280px]">
        <div className="readout mb-2">topics by heat</div>
        <ul className="flex flex-col">
          {byHeat.map((c) => {
            const mixed = c.coherence > 0 && c.coherence < 0.5;
            const active = selected === c.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelected(active ? null : c.id)}
                  aria-pressed={active}
                  className={`row-hover flex w-full cursor-pointer items-center gap-2.5 border-b border-[var(--grat-soft)] px-1 py-[7px] text-left ${
                    active ? 'bg-[rgba(87,217,163,0.06)]' : ''
                  }`}
                >
                  <span
                    aria-hidden
                    className="h-[8px] w-[8px] shrink-0 rounded-full"
                    style={{ background: 'var(--phosphor)', opacity: 0.25 + c.heat * 0.65 }}
                  />
                  <span
                    className="mono min-w-0 flex-1 truncate text-[10.5px] tracking-[0.06em] uppercase"
                    style={{ color: mixed ? 'var(--ink-4)' : active ? 'var(--ink)' : 'var(--ink-3)' }}
                  >
                    {c.label}
                    {mixed ? ' (mixed)' : ''}
                  </span>
                  <span className="mono shrink-0 text-[10px]" style={{ color: 'var(--ink-4)' }}>
                    {c.size}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {selectedCluster && (
          <div className="anim-in mt-5">
            <div className="readout mb-1.5" style={{ color: 'var(--phosphor)' }}>
              &#9646; {selectedCluster.label}
            </div>
            {selectedCluster.summary && (
              <p className="mb-2 text-[12px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
                {selectedCluster.summary}
              </p>
            )}
            <ul className="flex flex-col">
              {memberStories.map((p) => (
                <li
                  key={p.id}
                  className="row-hover border-b border-[var(--grat-soft)] px-1 py-[6px] text-[12px] last:border-b-0"
                  style={{ color: 'var(--ink-2)' }}
                >
                  {p.url ? (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="decoration-[var(--grat-strong)] underline-offset-2 hover:underline"
                    >
                      {p.title}
                    </a>
                  ) : (
                    p.title
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
