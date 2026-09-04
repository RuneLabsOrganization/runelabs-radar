import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { kitPickHistory, verdictClaims } from '@/lib/db/schema';
import {
  correctionRate,
  falsifierCoverage,
  pickLongevity,
  reversalRate,
  STANDING_HORIZON_DAYS,
  verdictSummary,
} from '@/lib/science/verdict-accuracy';
import { useTestDb } from './helpers/db';

const DAY = 86_400_000;

type Row = { toPick: string; fromPick: string | null; changeKind: 'upgrade' | 'drift' | 'correction' | 'unclassified'; heldDays: number | null; task?: string };

function addRows(rows: Row[]): void {
  const db = getDb();
  let t = Date.now() - rows.length * DAY;
  for (const r of rows) {
    db.insert(kitPickHistory)
      .values({
        category: 'coding',
        task: r.task ?? 'agent',
        tier: 'best',
        fromPick: r.fromPick,
        toPick: r.toPick,
        reason: 'x',
        changeKind: r.changeKind,
        heldDays: r.heldDays,
        changedAt: new Date((t += DAY)),
      })
      .run();
  }
}

describe('pickLongevity — closed-flip median', () => {
  beforeEach(() => useTestDb());

  it('is the median held time of graded flips, with n', () => {
    addRows([
      { fromPick: 'A', toPick: 'B', changeKind: 'upgrade', heldDays: 10 },
      { fromPick: 'B', toPick: 'C', changeKind: 'correction', heldDays: 30 },
      { fromPick: 'C', toPick: 'D', changeKind: 'drift', heldDays: 50 },
    ]);
    const l = pickLongevity();
    expect(l.medianHeldDays).toBe(30);
    expect(l.closedFlips).toBe(3);
  });

  it('ignores ungraded rows and the -1 sentinel', () => {
    addRows([
      { fromPick: null, toPick: 'A', changeKind: 'unclassified', heldDays: -1 },
      { fromPick: 'A', toPick: 'B', changeKind: 'upgrade', heldDays: 20 },
    ]);
    expect(pickLongevity().medianHeldDays).toBe(20);
    expect(pickLongevity().closedFlips).toBe(1);
  });

  it('is null with nothing graded', () => {
    const l = pickLongevity();
    expect(l.medianHeldDays).toBeNull();
    expect(l.closedFlips).toBe(0);
  });
});

describe('pickLongevity — the censoring fix', () => {
  beforeEach(() => useTestDb());

  it('a board of old, still-standing picks is not published as a misleadingly low figure', () => {
    const db = getDb();
    // 10 cells whose picks have stood 200 days (first pick, never replaced)
    for (let i = 0; i < 10; i++) {
      db.insert(kitPickHistory)
        .values({
          category: 'coding',
          task: `task-${i}`,
          tier: 'best',
          fromPick: null,
          toPick: `Tool-${i}`,
          reason: 'initial',
          changeKind: 'unclassified',
          heldDays: -1,
          changedAt: new Date(Date.now() - 200 * DAY),
        })
        .run();
    }
    // one cell with a fast closed flip — a closed-only median would publish "5d"
    addRows([{ fromPick: 'A', toPick: 'B', changeKind: 'upgrade', heldDays: 5 }]);

    const l = pickLongevity();
    // the closed-only median is still reported, LABELED, with its n…
    expect(l.medianHeldDays).toBe(5);
    expect(l.closedFlips).toBe(1);
    // …but beside it: 10 of 11 datable picks have stood ≥ the horizon
    expect(l.standingDatable).toBe(11);
    expect(l.stillStanding).toBe(10);
    expect(l.standingPct).toBe(91);
    expect(l.horizonDays).toBe(STANDING_HORIZON_DAYS);
  });

  it('standingPct is null (never 0%) when no pick start is datable', () => {
    const l = pickLongevity();
    expect(l.standingPct).toBeNull();
    expect(l.standingDatable).toBe(0);
  });
});

describe('correctionRate', () => {
  beforeEach(() => useTestDb());

  it('counts corrections against graded flips only', () => {
    addRows([
      { fromPick: 'A', toPick: 'B', changeKind: 'upgrade', heldDays: 10 },
      { fromPick: 'B', toPick: 'C', changeKind: 'correction', heldDays: 10 },
      { fromPick: null, toPick: 'A', changeKind: 'unclassified', heldDays: -1 },
    ]);
    expect(correctionRate()).toEqual({ corrections: 1, graded: 2, pct: 50 });
  });

  it('is null on n=0 — "0% of nothing" reads as a perfect record, the page shows "—"', () => {
    // was pct: 0; changed because rendering 0% at n=0 flatters an empty board
    expect(correctionRate()).toEqual({ corrections: 0, graded: 0, pct: null });
  });
});

describe('reversalRate', () => {
  beforeEach(() => useTestDb());

  it('flags a cell that went A to B and back to A', () => {
    addRows([
      { fromPick: 'A', toPick: 'B', changeKind: 'upgrade', heldDays: 10 },
      { fromPick: 'B', toPick: 'A', changeKind: 'correction', heldDays: 10 },
    ]);
    expect(reversalRate()).toEqual({ reversed: 1, cells: 1, pct: 100 });
  });

  it('does not flag a cell that only moves forward', () => {
    addRows([
      { fromPick: 'A', toPick: 'B', changeKind: 'upgrade', heldDays: 10 },
      { fromPick: 'B', toPick: 'C', changeKind: 'upgrade', heldDays: 10 },
    ]);
    expect(reversalRate()).toEqual({ reversed: 0, cells: 1, pct: 0 });
  });

  it('counts cells independently', () => {
    addRows([
      { fromPick: 'A', toPick: 'B', changeKind: 'upgrade', heldDays: 10, task: 'agent' },
      { fromPick: 'B', toPick: 'A', changeKind: 'correction', heldDays: 10, task: 'agent' },
      { fromPick: 'X', toPick: 'Y', changeKind: 'upgrade', heldDays: 10, task: 'review' },
    ]);
    expect(reversalRate()).toEqual({ reversed: 1, cells: 2, pct: 50 });
  });

  it('is null on n=0, never 0%', () => {
    expect(reversalRate()).toEqual({ reversed: 0, cells: 0, pct: null });
  });
});

describe('falsifierCoverage', () => {
  beforeEach(() => useTestDb());

  it('reports the share of open claims carrying a real falsifier', () => {
    const db = getDb();
    const base = { category: 'coding', task: 'agent', tier: 'best' as const, horizonDays: 90, openedAt: new Date() };
    db.insert(verdictClaims).values({ ...base, pickName: 'A', falsifier: 'B beats it' }).run();
    db.insert(verdictClaims).values({ ...base, pickName: 'B', falsifier: 'unregistered' }).run();
    expect(falsifierCoverage()).toEqual({ registered: 1, open: 2, pct: 50 });
  });

  it('is null on n=0, never 0%', () => {
    // was pct: 0; an empty claim set is not a 0% track record
    expect(falsifierCoverage()).toEqual({ registered: 0, open: 0, pct: null });
  });
});

describe('verdictSummary', () => {
  beforeEach(() => useTestDb());

  it('an empty board reports "—" (null) everywhere, never a perfect-looking 0%', () => {
    const s = verdictSummary();
    expect(s.longevity.medianHeldDays).toBeNull();
    expect(s.longevity.standingPct).toBeNull();
    expect(s.correction.pct).toBeNull();
    expect(s.reversal.pct).toBeNull();
    expect(s.coverage.pct).toBeNull();
  });
});
