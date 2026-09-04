import { describe, it, expect } from 'vitest';
import { funnelStages, FUNNEL_CAPTION } from '@/components/PipelineFunnel';
import { TOP_SIGNAL_MIN } from '@/lib/bands';

describe('funnelStages — per-stage 7d counts, not a cohort funnel', () => {
  it('returns the four stages as raw counts with honest labels', () => {
    const stages = funnelStages({ items: 1200, stories: 300, curated: 80, topSignals: 12 });
    expect(stages).toEqual([
      { label: 'items fetched', value: 1200 },
      { label: 'stories', value: 300 },
      { label: 'curated', value: 80 },
      { label: `top signals ≥${TOP_SIGNAL_MIN}`, value: 12 },
    ]);
  });

  it('carries no stage-to-stage conversion percentages (the cohort fallacy)', () => {
    // items fetched this week don't become this week's curated stories —
    // a % between stages would compare different cohorts
    const stages = funnelStages({ items: 100, stories: 200, curated: 50, topSignals: 10 });
    for (const s of stages) {
      expect(s).not.toHaveProperty('conv');
      expect(s.label).not.toContain('%');
    }
    // stories can legitimately EXCEED items in a window (older items curated
    // this week) — a funnel% would print a nonsense 200% "conversion"
    expect(stages[1].value).toBeGreaterThan(stages[0].value);
  });

  it('the caption discloses the semantics', () => {
    expect(FUNNEL_CAPTION).toContain('7-day');
    expect(FUNNEL_CAPTION).toContain('not one cohort');
  });
});
