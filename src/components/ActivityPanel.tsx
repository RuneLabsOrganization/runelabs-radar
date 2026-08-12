'use client';

import * as React from 'react';
import { useState } from 'react';
import type { Domain } from '@/lib/domains';
import type { DayCount } from '@/lib/analytics';
import ActivityHeatmap from './ActivityHeatmap';
import ActivityTrace from './ActivityTrace';

/**
 * The activity section's view switch: `grid` (sector×day heatmap, default —
 * every sector readable) or `lines` (the classic overlapping polylines).
 * Same data, both views; nothing is lost by preferring the grid.
 */
export default function ActivityPanel({
  days,
  focus,
  spikes,
}: {
  days: DayCount[];
  focus?: Domain;
  spikes?: { date: string; domain: string }[];
}) {
  const [view, setView] = useState<'grid' | 'lines'>('grid');

  return (
    <div>
      <div className="mono mb-2 flex items-center gap-1.5 text-[10px] tracking-[0.06em]">
        <span style={{ color: 'var(--ink-4)' }}>view</span>
        {(['grid', 'lines'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={`cursor-pointer rounded-[3px] border px-2 py-0.5 uppercase transition-colors ${
              view === v
                ? 'border-[var(--phosphor)] text-[var(--ink)]'
                : 'border-[var(--grat)] text-[var(--ink-3)] hover:border-[var(--grat-strong)]'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      {view === 'grid' ? (
        <ActivityHeatmap days={days} focus={focus} spikes={spikes} />
      ) : (
        <ActivityTrace days={days} focus={focus} spikes={spikes} />
      )}
    </div>
  );
}
