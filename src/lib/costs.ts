// Client-safe module: pure cost math, no DB or node imports.

/**
 * Task archetypes translate $/1M-token pricing into the unit Runelabs actually
 * pays for: one concrete piece of work. Token budgets are stated assumptions,
 * shown in the UI — tune them as real usage data accumulates.
 */
export interface TaskArchetype {
  key: string;
  label: string;
  inTokens: number;
  outTokens: number;
  blurb: string;
}

export const TASK_ARCHETYPES: TaskArchetype[] = [
  {
    key: 'landing',
    label: 'Landing page',
    inTokens: 6_000,
    outTokens: 12_000,
    blurb: 'vibecode a landing page — spec + context in, multi-file code out',
  },
  {
    key: 'snippet',
    label: 'Code snippet',
    inTokens: 1_500,
    outTokens: 800,
    blurb: 'one function with surrounding context',
  },
  {
    key: 'email',
    label: 'Marketing email',
    inTokens: 800,
    outTokens: 600,
    blurb: 'brief in, polished email out',
  },
  {
    key: 'adset',
    label: 'Ad set ×10',
    inTokens: 1_000,
    outTokens: 1_200,
    blurb: 'ten ad-copy variants from one product brief',
  },
  {
    key: 'agent',
    label: 'Agent session',
    inTokens: 150_000,
    outTokens: 15_000,
    blurb: '~50-turn agentic session — input-heavy, rankings flip here',
  },
  {
    key: 'review',
    label: 'PR review',
    inTokens: 20_000,
    outTokens: 2_000,
    blurb: 'full diff in, findings out',
  },
];

/** Dollar cost of one task on a model; null when the model has no split pricing. */
export function taskCost(
  m: { priceIn: number | null; priceOut: number | null },
  t: TaskArchetype,
): number | null {
  if (m.priceIn === null || m.priceOut === null) return null;
  return (t.inTokens * m.priceIn + t.outTokens * m.priceOut) / 1e6;
}

/** Compact dollar formatting across four orders of magnitude. */
export function fmtUsd(v: number): string {
  if (v >= 10) return `$${v.toFixed(1)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(4)}`;
}

/** Compact "intelligence points per dollar" formatting (ratios span 1..100k). */
export function fmtPtsPerDollar(v: number): string {
  const n =
    v >= 10_000
      ? `${Math.round(v / 1000)}k`
      : v >= 1000
        ? `${(v / 1000).toFixed(1)}k`
        : v >= 100
          ? v.toFixed(0)
          : v >= 10
            ? v.toFixed(1)
            : v.toFixed(2);
  return `${n} pts/$`;
}
