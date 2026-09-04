import { beforeEach, describe, expect, it } from 'vitest';
import { parseSubScores, coerceSubScore, SUB_KEYS, compositeScore, FLIP_WEIGHTS } from '@/lib/opportunities/axes';
import { oppViewFromRow } from '@/lib/opportunities/view';
import { opportunities } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';

type OppRow = typeof opportunities.$inferSelect;

const full = (v: number) => Object.fromEntries(SUB_KEYS.map((k) => [k, v]));

function rowWithScores(scores: string): OppRow {
  const now = new Date();
  return {
    id: 1,
    slug: 'shared-parser',
    ownerUserId: null,
    title: 'Shared parser check',
    thesis: 'A sufficiently long thesis for the view model to carry.',
    sector: 'devtools',
    status: 'active',
    flipScore: 50,
    holdScore: 50,
    scores,
    kpis: null,
    evidence: '[]',
    window: null,
    windowMonths: 6,
    verdict: 'watch',
    confidence: 50,
    review: null,
    reviewedAt: now,
    brief: null,
    briefGeneratedAt: null,
    plan: null,
    planGeneratedAt: null,
    planRuns: 0,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}

describe('parseSubScores (F7 — the one parser for stored sub-scores)', () => {
  it('clamps into 0..20 and rounds — the same row scores identically on every surface', () => {
    const json = JSON.stringify({ ...full(14), demand: 16.6, moat: 25, margin: -3 });
    const parsed = parseSubScores(json);
    expect(parsed.legacy).toBe(false);
    expect(parsed.sub.demand).toBe(17);
    expect(parsed.sub.moat).toBe(20); // clamped
    expect(parsed.sub.margin).toBe(0); // clamped
    expect(parsed.missing).toEqual([]);
    // the dossier view reads the SAME numbers through the same parser
    useTestDb();
    const view = oppViewFromRow(rowWithScores(json));
    expect(view.sub).toEqual(parsed.sub);
    expect(view.legacy).toBe(false);
  });

  it('coerces numeric strings like the proposal sanitizer does', () => {
    const parsed = parseSubScores(JSON.stringify({ ...full(10), demand: '15' }));
    expect(parsed.sub.demand).toBe(15);
    expect(parsed.missing).toEqual([]);
    expect(coerceSubScore(' 12 ')).toBe(12);
    expect(coerceSubScore('twelve')).toBeNull();
    expect(coerceSubScore(NaN)).toBeNull();
    expect(coerceSubScore(undefined)).toBeNull();
  });

  it('records non-finite/absent axes in `missing` and zero-fills them (feeds F10)', () => {
    const parsed = parseSubScores(JSON.stringify({ ...full(12), demand: 'loud', timing: undefined }));
    expect(parsed.sub.demand).toBe(0);
    // an explicit `undefined` overrides the spread and drops out of the JSON
    expect(parsed.missing).toEqual(['demand', 'timing']);
    // a 3-missing payload reports all three for the gate's confidence cap
    // (moat must stay numeric — a non-numeric moat marks the row legacy)
    const three = parseSubScores(JSON.stringify({ ...full(12), demand: null, margin: NaN, timing: 'x' }));
    expect(three.missing.sort()).toEqual(['demand', 'margin', 'timing'].sort());
    expect(three.sub.demand).toBe(0);
  });

  it('flags corrupt JSON as legacy (zeros + all axes missing) — everywhere, including forge', () => {
    // pre-fix forge's private copy zero-filled with NO legacy flag, so a
    // corrupt row scored as "terrible on all axes" and got gated as if real
    const parsed = parseSubScores('{not-json');
    expect(parsed.legacy).toBe(true);
    expect(parsed.missing).toEqual([...SUB_KEYS]);
    for (const k of SUB_KEYS) expect(parsed.sub[k]).toBe(0);
    expect(compositeScore(parsed.sub, FLIP_WEIGHTS)).toBe(0);
  });

  it('flags pre-dossier rows (no numeric moat) as legacy — the R10 rule, in one place', () => {
    const parsed = parseSubScores(JSON.stringify({ demand: 16, buildability: 15 }));
    expect(parsed.legacy).toBe(true);
    expect(parsed.sub.demand).toBe(16); // legacy flags gating, it does not erase the axes that exist
    expect(parsed.sub.moat).toBe(0);
    expect(parsed.missing).toHaveLength(SUB_KEYS.length - 2);
  });

  it('a fractional stored value rounds identically for the view and the gate paths', () => {
    // pre-fix: rescore rounded, forge clamped without rounding, view passed
    // through — one stored row, three composites
    const json = JSON.stringify(full(13.7));
    const viaParser = parseSubScores(json);
    useTestDb();
    const viaView = oppViewFromRow(rowWithScores(json)).sub;
    expect(viaView).toEqual(viaParser.sub);
    expect(viaParser.sub.demand).toBe(14);
  });
});
