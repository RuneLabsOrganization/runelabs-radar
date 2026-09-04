import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HINDSIGHT_WEIGHTS } from '@/lib/science/hindsight';
import { STANDING_HORIZON_DAYS } from '@/lib/science/verdict-accuracy';

/**
 * The trust page publishes the scoring methodology. It must DERIVE from the
 * module constants, never hand-copy them — the old page hard-coded 30/25/25/±15
 * and would have kept publishing them after the lib moved. These pins fail if
 * the weights ever change without a deliberate decision, and the source check
 * fails if the page ever stops consuming the module.
 */
const pageSource = readFileSync(
  new URL('../src/app/(site)/trust/page.tsx', import.meta.url),
  'utf8',
);

describe('trust page methodology mirror', () => {
  it('pins the hindsight weights — the values the page publishes', () => {
    expect(HINDSIGHT_WEIGHTS).toEqual({
      entityEcho: { max: 30, fullMarksAt: 5 },
      launch: 25,
      followThrough: { max: 25, fullMarksAt: 5 },
      votes: { perNetVote: 5, cap: 15 },
    });
  });

  it('the page derives its weights table from the module, not string literals', () => {
    expect(pageSource).toContain("import { HINDSIGHT_WEIGHTS } from '@/lib/science/hindsight'");
    // no hand-copied weight literals like the old '≤30' / '× 5' strings
    expect(pageSource).not.toMatch(/weight: '≤?\d+'/);
    expect(pageSource).not.toMatch(/pct: '\d+%'/);
  });

  it('the published "still standing" horizon is the module constant', () => {
    expect(STANDING_HORIZON_DAYS).toBe(30);
  });
});
