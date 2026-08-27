import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { kitPickHistory, verdictClaims } from '@/lib/db/schema';
import {
  correctionRate,
  falsifierCoverage,
  pickHalfLife,
  reversalRate,
} from '@/lib/science/verdict-accuracy';
import { useTestDb } from './helpers/db';

type Row = { toPick: string; fromPick: string | null; changeKind: 'upgrade' | 'drift' | 'correction' | 'unclassified'; heldDays: number | null; task?: string };

function addRows(rows: Row[]): void {
  const db = getDb();
  let t = Date.now() - rows.length * 86_400_000;
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
        changedAt: new Date((t += 86_400_000)),
      })
      .run();
  }
}

describe('pickHalfLife', () => {
  beforeEach(() => useTestDb());

  it('is the median held time of graded flips', () => {
    addRows([
      { fromPick: 'A', toPick: 'B', changeKind: 'upgrade', heldDays: 10 },
      { fromPick: 'B', toPick: 'C', changeKind: 'correction', heldDays: 30 },
      { fromPick: 'C', toPick: 'D', changeKind: 'drift', heldDays: 50 },
    ]);
    expect(pickHalfLife()).toBe(30);
  });

  it('ignores ungraded rows and the -1 sentinel', () => {
    addRows([
      { fromPick: null, toPick: 'A', changeKind: 'unclassified', heldDays: -1 },
      { fromPick: 'A', toPick: 'B', changeKind: 'upgrade', heldDays: 20 },
    ]);
    expect(pickHalfLife()).toBe(20);
  });

  it('is null with nothing graded', () => {
    expect(pickHalfLife()).toBeNull();
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

  it('is zero-safe with no graded flips', () => {
    expect(correctionRate()).toEqual({ corrections: 0, graded: 0, pct: 0 });
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

  it('is zero-safe with no claims', () => {
    expect(falsifierCoverage()).toEqual({ registered: 0, open: 0, pct: 0 });
  });
});
