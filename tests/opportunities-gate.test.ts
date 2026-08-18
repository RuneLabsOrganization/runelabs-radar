import { describe, expect, it } from 'vitest';
import {
  applyGate,
  blendScore,
  parseWindowMonths,
  unverifiedCritic,
  type CriticResult,
  type GateInput,
} from '@/lib/opportunities/gate';
import { sanitizeCritiques } from '@/lib/opportunities/critic';
import type { SubScores } from '@/lib/opportunities/axes';

const sub = (over: Partial<SubScores> = {}): SubScores => ({
  demand: 15,
  buildability: 15,
  margin: 15,
  competition: 15,
  timing: 15,
  moat: 15,
  regClear: 15,
  platformSafe: 15,
  distribution: 15,
  qualityBar: 15,
  ...over,
});

const critic = (over: Partial<CriticResult> = {}): CriticResult => ({
  slug: 'x',
  verdict: 'pursue',
  confidence: 80,
  killRisks: [],
  adjustments: [],
  flags: [],
  ...over,
});

const input = (over: Partial<GateInput> = {}): GateInput => ({
  sub: sub(),
  kpis: null,
  windowMonths: 18,
  evidenceCount: 3,
  legacy: false,
  ...over,
});

describe('parseWindowMonths', () => {
  it('takes the pessimistic low end of a range', () => {
    expect(parseWindowMonths('3-4 months before fine-tuning makes this obsolete')).toBe(3);
    expect(parseWindowMonths('6-9 months before commoditization')).toBe(6);
    expect(parseWindowMonths('1-2 years')).toBe(12);
  });

  it('converts weeks, ignores prose without a duration', () => {
    expect(parseWindowMonths('4-8 weeks')).toBe(1);
    expect(parseWindowMonths('whenever the market feels like it')).toBeNull();
    expect(parseWindowMonths(null)).toBeNull();
  });
});

describe('applyGate', () => {
  it('passes a clean pursue through uncapped', () => {
    const out = applyGate(input(), critic());
    expect(out.flipScore).toBe(75);
    expect(out.holdScore).toBe(75);
    expect(out.verdict).toBe('pursue');
    expect(out.confidence).toBe(80);
    expect(out.review.capsApplied).toEqual([]);
  });

  it('reproduces the #181 failure and fixes it: hold 78 with a 3-4 month window caps to 45', () => {
    // the exact production row that triggered this rework
    const sub181 = sub({
      demand: 18, buildability: 19, margin: 16, competition: 17, timing: 20,
      moat: 8, regClear: 20, platformSafe: 15, distribution: 14, qualityBar: 17,
    });
    const out = applyGate(
      input({ sub: sub181, windowMonths: parseWindowMonths('3-4 months before model fine-tuning or built-in presets make this obsolete'), evidenceCount: 2 }),
      critic(),
    );
    expect(out.review.rawHold).toBe(78); // the inflated number stays in the audit trail
    expect(out.holdScore).toBe(45);
    expect(out.review.capsApplied).toContainEqual({ play: 'hold', rule: 'window ≤ 4mo', from: 78, to: 45 });
    expect(out.verdict).toBe('watch'); // any cap downgrades pursue → watch
    expect(out.flipScore).toBe(88); // flip survives: speed plays are fine with short windows
  });

  it('R1: a window of ≤ 2 months is un-executable → reject', () => {
    const out = applyGate(input({ windowMonths: 2 }), critic());
    expect(out.flipScore).toBeLessThanOrEqual(40);
    expect(out.holdScore).toBeLessThanOrEqual(30);
    expect(out.verdict).toBe('reject');
  });

  it('R5/R6: no moat, no MRR story', () => {
    expect(applyGate(input({ sub: sub({ moat: 8 }) }), critic()).holdScore).toBeLessThanOrEqual(60);
    expect(applyGate(input({ sub: sub({ moat: 4 }) }), critic()).holdScore).toBeLessThanOrEqual(50);
  });

  it('R7: "open field" contradicted by named competitors forces the axis down', () => {
    const out = applyGate(
      input({ sub: sub({ competition: 18 }), kpis: { initialCostUsd: null, monthlyCostUsd: null, priceUsd: null, breakEvenCustomers: null, competitorCount: 7 } }),
      critic(),
    );
    expect(out.review.flags.some((f) => f.includes('contradicted by 7'))).toBe(true);
    expect(out.verdict).toBe('watch'); // a flag alone already downgrades pursue
    // competition 18 → 77 raw; forced to 12 → 77 − 0.10×6×5 = 74
    expect(out.review.rawFlip).toBe(77);
    expect(out.flipScore).toBe(74);
  });

  it('R8: economics that cannot close inside the window cap both plays', () => {
    const kpis = { initialCostUsd: 10000, monthlyCostUsd: 500, priceUsd: 20, breakEvenCustomers: 30, competitorCount: null };
    const out = applyGate(input({ kpis, windowMonths: 6 }), critic());
    // monthly profit = 30×20−500 = 100 → payback 100 months vs a 6-month window
    expect(out.review.flags.some((f) => f.includes('payback'))).toBe(true);
    expect(out.flipScore).toBeLessThanOrEqual(50);
    expect(out.holdScore).toBeLessThanOrEqual(50);
  });

  it('R8: economics that never break even at all', () => {
    const kpis = { initialCostUsd: 5000, monthlyCostUsd: 500, priceUsd: 10, breakEvenCustomers: 30, competitorCount: null };
    const out = applyGate(input({ kpis }), critic());
    expect(out.review.flags).toContain('never breaks even at stated economics');
    expect(out.flipScore).toBeLessThanOrEqual(50);
  });

  it('R9: confidence follows citation depth', () => {
    expect(applyGate(input({ evidenceCount: 0 }), critic()).confidence).toBeLessThanOrEqual(30);
    expect(applyGate(input({ evidenceCount: 1 }), critic()).confidence).toBeLessThanOrEqual(50);
    expect(applyGate(input({ evidenceCount: 0 }), critic()).verdict).toBe('watch');
  });

  it('critic axis adjustments apply clamped, and land in the trail', () => {
    const out = applyGate(
      input(),
      critic({ adjustments: [{ axis: 'moat', delta: -6, reason: 'no defensibility named' }], flags: [] }),
    );
    // moat 15 → 9; hold drops 0.14*6*5 ≈ 4, flip 0.02*6*5 ≈ 1
    expect(out.holdScore).toBe(71);
    expect(out.flipScore).toBe(74);
    expect(out.review.adjustments).toEqual([{ axis: 'moat', delta: -6, reason: 'no defensibility named' }]);
    expect(out.review.rawHold).toBe(75); // pre-adjustment number preserved
  });

  it('a critic reject sticks; confidence under 30 rejects too', () => {
    expect(applyGate(input(), critic({ verdict: 'reject' })).verdict).toBe('reject');
    expect(applyGate(input(), critic({ confidence: 25 })).verdict).toBe('reject');
  });

  it('critic unavailable → unverified: watch/40, never silently strong', () => {
    const out = applyGate(input(), unverifiedCritic('x'));
    expect(out.verdict).toBe('watch');
    expect(out.confidence).toBe(40);
    expect(out.review.criticUnavailable).toBe(true);
  });

  it('R10: legacy rows bypass the gate entirely', () => {
    const out = applyGate(input({ legacy: true, sub: sub({ moat: 2 }), windowMonths: 1 }), critic());
    expect(out.flipScore).toBe(out.review.rawFlip);
    expect(out.review.capsApplied).toEqual([]);
    expect(out.review.flags).toEqual(['legacy-row']);
  });
});

describe('blendScore', () => {
  it('is transparent without a prior and damped with one', () => {
    expect(blendScore(80, null)).toBe(80);
    expect(blendScore(80, 50)).toBe(71); // 0.7×80 + 0.3×50
  });
});

describe('sanitizeCritiques', () => {
  const slugs = new Set(['a', 'b']);

  it('bounds verdict, confidence, risks, adjustments, flags', () => {
    const out = sanitizeCritiques(
      [
        {
          slug: 'a',
          verdict: 'yolo',
          confidence: 250,
          killRisks: ['one\nline', 'two', 'three', 'four'],
          axisAdjustments: [
            { axis: 'moat', delta: -99, reason: 'way too generous' },
            { axis: 'not-an-axis', delta: 3, reason: 'bogus' },
          ],
          coherenceFlags: ['f1', 'f2', 'f3', 'f4', 'f5'],
        },
        { slug: 'unknown-slug', verdict: 'pursue', confidence: 90 },
        'garbage',
      ],
      slugs,
    );
    expect(out).toHaveLength(1);
    const r = out[0];
    expect(r.verdict).toBe('watch'); // invalid verdict → watch
    expect(r.confidence).toBe(100); // clamped
    expect(r.killRisks).toHaveLength(3);
    expect(r.killRisks[0]).toBe('one line'); // newline flattened
    expect(r.adjustments).toEqual([{ axis: 'moat', delta: -6, reason: 'way too generous' }]);
    expect(r.flags).toHaveLength(4);
  });

  it('defaults missing fields to a safe watch/40', () => {
    const out = sanitizeCritiques([{ slug: 'a' }], slugs);
    expect(out[0]).toMatchObject({ verdict: 'watch', confidence: 40, killRisks: [], adjustments: [], flags: [] });
  });

  it('accepts numeric-string confidence (models emit "75" often enough)', () => {
    const out = sanitizeCritiques([{ slug: 'a', confidence: '75' }, { slug: 'b', confidence: 'high' }], slugs);
    expect(out[0].confidence).toBe(75);
    expect(out[1].confidence).toBe(40); // non-numeric string → default
  });
});
