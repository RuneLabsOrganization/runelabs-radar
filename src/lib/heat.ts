import { DOMAINS, type Domain } from './domains';
import type { DayCount } from './analytics';

/** Per-sector max cell value over the window (zero-filled days included). */
export function rowMaxes(days: DayCount[]): Record<Domain, number> {
  const out = Object.fromEntries(DOMAINS.map((d) => [d, 0])) as Record<Domain, number>;
  for (const day of days) {
    for (const d of DOMAINS) {
      const v = day.byDomain[d] ?? 0;
      if (v > out[d]) out[d] = v;
    }
  }
  return out;
}

/** Largest single cell in the whole grid. */
export function globalMax(days: DayCount[]): number {
  let max = 0;
  for (const day of days) {
    for (const d of DOMAINS) {
      const v = day.byDomain[d] ?? 0;
      if (v > max) max = v;
    }
  }
  return max;
}

/**
 * Cell fill intensity: 0 for empty cells (neutral fill), otherwise a floor of
 * 0.14 so single-story days stay visible, ramping to 1 at the row/grid max.
 */
export function cellAlpha(v: number, max: number): number {
  if (v <= 0 || max <= 0) return 0;
  return 0.14 + 0.86 * Math.min(1, v / max);
}

/** UTC Saturday/Sunday check for column dimming. */
export function isWeekend(date: string): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}
