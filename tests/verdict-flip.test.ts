import { beforeEach, describe, expect, it } from 'vitest';
import { desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { kitPickHistory, stories } from '@/lib/db/schema';
import { classifyFlip, type FlipInput } from '@/lib/kits/flip';
import { runVerdictGrade } from '@/lib/science/verdicts';
import { useTestDb } from './helpers/db';

function flip(over: Partial<FlipInput> = {}): FlipInput {
  return {
    reason: 'board proposal approved',
    fromPick: 'Tool A',
    heldDays: 60,
    replacementExistedAtCall: true,
    ...over,
  };
}

describe('classifyFlip', () => {
  it('does not grade the first pick for a cell', () => {
    expect(classifyFlip(flip({ fromPick: null })).kind).toBe('unclassified');
  });

  it('calls it an upgrade when the replacement did not exist at call time', () => {
    const r = classifyFlip(flip({ replacementExistedAtCall: false }));
    expect(r.kind).toBe('upgrade');
    expect(r.why).toContain('did not exist');
  });

  it('calls it drift when the reason is a price change', () => {
    expect(classifyFlip(flip({ reason: 'pricing changed to usage-based' })).kind).toBe('drift');
  });

  it('calls it drift when the tool was discontinued', () => {
    expect(classifyFlip(flip({ reason: 'vendor discontinued the product' })).kind).toBe('drift');
  });

  it('calls it drift on a licence change', () => {
    expect(classifyFlip(flip({ reason: 'license switched to proprietary' })).kind).toBe('drift');
  });

  it('calls it a correction when a then-available option was better all along', () => {
    const r = classifyFlip(flip({ reason: 'Tool B was always stronger on long-context' }));
    expect(r.kind).toBe('correction');
    expect(r.why).toContain('available at call time');
  });
});

const DAY = 86_400_000;

function addHistory(over: { fromPick: string | null; toPick: string; reason: string; changedAt: Date }) {
  getDb()
    .insert(kitPickHistory)
    .values({ category: 'coding', task: 'agent', tier: 'best', ...over })
    .run();
}

describe('runVerdictGrade', () => {
  beforeEach(() => useTestDb());

  it('computes heldDays from the previous change and classifies the flip', async () => {
    const t0 = new Date(Date.now() - 100 * DAY);
    const t1 = new Date(Date.now() - 40 * DAY);
    addHistory({ fromPick: null, toPick: 'Tool A', reason: 'initial', changedAt: t0 });
    // Tool B was already being written about before the Tool A call
    getDb()
      .insert(stories)
      .values({ title: 'Tool B launches', status: 'curated', topScore: 70, createdAt: new Date(Date.now() - 120 * DAY) })
      .run();
    addHistory({ fromPick: 'Tool A', toPick: 'Tool B', reason: 'Tool B is stronger', changedAt: t1 });

    const out = await runVerdictGrade();
    expect(out.graded).toBe(2);

    const rows = getDb().select().from(kitPickHistory).orderBy(desc(kitPickHistory.changedAt)).all();
    const flip = rows.find((r) => r.toPick === 'Tool B')!;
    expect(flip.heldDays).toBe(60);
    expect(flip.changeKind).toBe('correction');

    const first = rows.find((r) => r.toPick === 'Tool A')!;
    expect(first.changeKind).toBe('unclassified');
  });

  it('calls it an upgrade when the replacement first appeared after the call', async () => {
    const t0 = new Date(Date.now() - 100 * DAY);
    const t1 = new Date(Date.now() - 40 * DAY);
    addHistory({ fromPick: null, toPick: 'Tool A', reason: 'initial', changedAt: t0 });
    getDb()
      .insert(stories)
      .values({ title: 'Tool C launches', status: 'curated', topScore: 70, createdAt: new Date(Date.now() - 60 * DAY) })
      .run();
    addHistory({ fromPick: 'Tool A', toPick: 'Tool C', reason: 'Tool C is stronger', changedAt: t1 });

    await runVerdictGrade();
    const flip = getDb().select().from(kitPickHistory).all().find((r) => r.toPick === 'Tool C')!;
    expect(flip.changeKind).toBe('upgrade');
  });

  it('is idempotent — already-graded rows are not re-graded', async () => {
    addHistory({ fromPick: null, toPick: 'Tool A', reason: 'initial', changedAt: new Date(Date.now() - 10 * DAY) });
    await runVerdictGrade();
    const second = await runVerdictGrade();
    expect(second.graded).toBe(0);
  });
});
