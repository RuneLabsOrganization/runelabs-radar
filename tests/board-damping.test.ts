import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { boardEntries, boardHistory, boardProposals, kitPickHistory, kitPicks, stories, verdictClaims } from '@/lib/db/schema';
import { applyProposal } from '@/lib/board/apply';
import {
  DEFAULT_DAMPING,
  dampingPolicyFromEnv,
  decidePickChange,
  pickKey,
  samePick,
  storyEvidenceSince,
  type CellChange,
  type DampingPolicy,
} from '@/lib/board/damping';

const DAY = 86_400_000;
const NOW = new Date('2026-11-21T06:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const noEvidence = (_pick: string, _since: Date) => false;

describe('pick normalisation — a reorder is not a change', () => {
  it('treats reordered, re-cased and re-spaced combos as the same pick', () => {
    expect(samePick('Cursor + Claude Sonnet 4.5', 'claude sonnet 4.5 + cursor')).toBe(true);
    expect(samePick('Cursor & Claude  Sonnet 4.5', 'Claude Sonnet 4.5, Cursor')).toBe(true);
    expect(samePick('Runway / Kling', 'Kling and Runway')).toBe(true);
    expect(samePick('Claude Code (Opus 4.1)', 'claude code(opus 4.1).')).toBe(true);
    expect(pickKey('B + A + A')).toBe('a + b');
  });

  it('still tells different picks apart', () => {
    expect(samePick('Cursor + Claude Sonnet 4.5', 'Cursor + GPT-5')).toBe(false);
    expect(samePick('Cursor', 'Cursor + Claude Sonnet 4.5')).toBe(false);
    expect(samePick('ChatGPT Plus', 'ChatGPT')).toBe(false);
    expect(samePick(null, 'Cursor')).toBe(false);
    expect(samePick(null, null)).toBe(true);
  });
});

describe('decidePickChange — pure hysteresis rules', () => {
  const policy: DampingPolicy = { minHoldDays: 6, revertWindowDays: 30 };
  const decide = (current: string | null, proposed: string, history: CellChange[], ev = noEvidence) =>
    decidePickChange({ current, proposed, history, now: NOW, policy, hasNewEvidence: ev });

  it('applies the first pick for an empty cell', () => {
    expect(decide(null, 'A', []).kind).toBe('apply');
  });

  it('reports a reordered combo as the same pick, not a change', () => {
    expect(decide('A + B', 'B + A', [{ fromPick: null, toPick: 'A + B', changedAt: ago(1) }]).kind).toBe('same');
  });

  it('holds any change within the min-hold window of the last change, evidence or not', () => {
    const d = decide('B', 'C', [{ fromPick: 'A', toPick: 'B', changedAt: ago(0.01) }], () => true);
    expect(d).toMatchObject({ kind: 'hold', rule: 'min-hold' });
  });

  it('lets the weekly cadence through: 7 days after the last change is past the min hold', () => {
    expect(decide('B', 'C', [{ fromPick: 'A', toPick: 'B', changedAt: ago(7) }]).kind).toBe('apply');
  });

  it('holds a flip back to a recently replaced pick when nothing new names it', () => {
    const history = [
      { fromPick: null, toPick: 'A', changedAt: ago(40) },
      { fromPick: 'A', toPick: 'B', changedAt: ago(8) },
    ];
    const d = decide('B', 'a', history);
    expect(d).toMatchObject({ kind: 'hold', rule: 'revert' });
    if (d.kind === 'hold') expect(d.since).toEqual(ago(8));
  });

  it('allows the revert when there is new evidence about the replaced pick since it was replaced', () => {
    const history = [{ fromPick: 'A', toPick: 'B', changedAt: ago(8) }];
    const seen: Array<[string, Date]> = [];
    const d = decide('B', 'A', history, (pick, since) => {
      seen.push([pick, since]);
      return true;
    });
    expect(d.kind).toBe('apply');
    expect(seen).toEqual([['A', ago(8)]]);
  });

  it('allows the revert once the revert window has passed', () => {
    expect(decide('B', 'A', [{ fromPick: 'A', toPick: 'B', changedAt: ago(31) }]).kind).toBe('apply');
  });

  it('a policy of zeros disables both rules', () => {
    const d = decidePickChange({
      current: 'B',
      proposed: 'A',
      history: [{ fromPick: 'A', toPick: 'B', changedAt: ago(0) }],
      now: NOW,
      policy: { minHoldDays: 0, revertWindowDays: 0 },
      hasNewEvidence: noEvidence,
    });
    expect(d.kind).toBe('apply');
  });
});

describe('dampingPolicyFromEnv', () => {
  it('defaults, honours overrides and ignores junk', () => {
    expect(dampingPolicyFromEnv({})).toEqual(DEFAULT_DAMPING);
    expect(dampingPolicyFromEnv({ BOARD_MIN_HOLD_DAYS: '2', BOARD_REVERT_WINDOW_DAYS: '0' })).toEqual({
      minHoldDays: 2,
      revertWindowDays: 0,
    });
    expect(dampingPolicyFromEnv({ BOARD_MIN_HOLD_DAYS: 'soon', BOARD_REVERT_WINDOW_DAYS: '-3' })).toEqual(DEFAULT_DAMPING);
  });
});

describe('applyProposal with damping', () => {
  let db: Db;
  const DOMAIN = 'coding';
  const TASK = 'agentic-coding';
  const policy = DEFAULT_DAMPING;

  beforeEach(() => {
    db = useTestDb();
  });

  function propose(proposed: Record<string, unknown>, rationale = 'because'): number {
    return db
      .insert(boardProposals)
      .values({
        domain: DOMAIN,
        task: TASK,
        proposed: JSON.stringify(proposed),
        rationale,
        status: 'pending',
        createdAt: new Date(),
      })
      .returning({ id: boardProposals.id })
      .get().id;
  }

  const bestPick = () =>
    db
      .select()
      .from(kitPicks)
      .where(and(eq(kitPicks.category, DOMAIN), eq(kitPicks.task, TASK), eq(kitPicks.tier, 'best')))
      .get();
  const bestHistory = () =>
    db
      .select()
      .from(kitPickHistory)
      .where(and(eq(kitPickHistory.category, DOMAIN), eq(kitPickHistory.task, TASK), eq(kitPickHistory.tier, 'best')))
      .all();
  /** Push every recorded change for the cell back by `days`. */
  const ageHistory = (days: number) => {
    for (const row of bestHistory()) {
      db.update(kitPickHistory)
        .set({ changedAt: new Date(row.changedAt.getTime() - days * DAY) })
        .where(eq(kitPickHistory.id, row.id))
        .run();
    }
  };

  it('a reordered combo writes no history, no claim and keeps the board spelling — damped or not', async () => {
    await applyProposal(propose({ bestOverall: 'Cursor + Claude Sonnet 4.5' }));
    const before = bestHistory().length;
    const claimsBefore = db.select().from(verdictClaims).all().length;

    await applyProposal(propose({ bestOverall: 'claude sonnet 4.5 + Cursor' }));
    await applyProposal(propose({ bestOverall: 'Claude Sonnet 4.5 & Cursor' }), { damping: policy });

    expect(bestHistory()).toHaveLength(before);
    expect(db.select().from(verdictClaims).all()).toHaveLength(claimsBefore);
    expect(bestPick()?.pickName).toBe('Cursor + Claude Sonnet 4.5');
    const entry = db.select().from(boardEntries).where(eq(boardEntries.task, TASK)).get();
    expect(entry?.bestOverall).toBe('Cursor + Claude Sonnet 4.5');
  });

  it('holds a second change to the same cell inside the min hold (one change per cell per run)', async () => {
    await applyProposal(propose({ bestOverall: 'Tool A' }), { damping: policy });
    ageHistory(10);
    await applyProposal(propose({ bestOverall: 'Tool B' }), { damping: policy });
    const res = await applyProposal(propose({ bestOverall: 'Tool C', costNote: 'about Tool C' }), {
      damping: policy,
    });

    expect(res.ok).toBe(true);
    expect(res.held).toEqual([expect.objectContaining({ field: 'bestOverall', rule: 'min-hold' })]);
    expect(bestPick()?.pickName).toBe('Tool B');
    expect(bestHistory().map((h) => h.toPick)).toEqual(['Tool A', 'Tool B']);
    // the cost note was written about Tool C — it must not land beside Tool B
    expect(bestPick()?.priceNote).not.toBe('about Tool C');
    const last = db.select().from(boardHistory).all().at(-1);
    expect(last?.change).toMatch(/^bestOverall: held \(/);
  });

  it('blocks A → B → A inside the revert window, then allows it once news names A again', async () => {
    await applyProposal(propose({ bestOverall: 'Tool A' }), { damping: policy });
    ageHistory(20);
    await applyProposal(propose({ bestOverall: 'Tool B' }), { damping: policy });
    ageHistory(8); // B has stood 8 days: past the min hold, inside the 30-day revert window

    const blocked = await applyProposal(propose({ bestOverall: 'tool a' }, 'flip back'), { damping: policy });
    expect(blocked.held).toEqual([expect.objectContaining({ field: 'bestOverall', rule: 'revert' })]);
    expect(bestPick()?.pickName).toBe('Tool B');
    // a held pick must not drag its rationale onto the board as the verdict
    const entry = db.select().from(boardEntries).where(eq(boardEntries.task, TASK)).get();
    expect(entry?.runelabsVerdict).not.toBe('flip back');

    db.insert(stories)
      .values({ title: 'Tool A ships 2x faster agent mode', status: 'curated', createdAt: new Date(Date.now() - DAY) })
      .run();
    const allowed = await applyProposal(propose({ bestOverall: 'Tool A' }, 'A is back on top'), { damping: policy });
    expect(allowed.held).toEqual([]);
    expect(bestPick()?.pickName).toBe('Tool A');
  });

  it('holds only the damped tier; the rest of the proposal applies', async () => {
    await applyProposal(propose({ bestOverall: 'Tool A', bestValue: 'Value A' }), { damping: policy });
    const res = await applyProposal(propose({ bestOverall: 'Tool B', bestValue: 'Value A + Extra' }), {
      damping: policy,
    });
    // both cells changed seconds ago, so both are inside the min hold
    expect(res.held.map((h) => h.field).sort()).toEqual(['bestOverall', 'bestValue']);

    // a cell that has never been set is not damped
    const fresh = await applyProposal(propose({ cheapestViable: 'Cheap X' }), { damping: policy });
    expect(fresh.held).toEqual([]);
  });

  it('without a damping policy (the admin approve path) a human can still flip back immediately', async () => {
    await applyProposal(propose({ bestOverall: 'Tool A' }));
    await applyProposal(propose({ bestOverall: 'Tool B' }));
    const res = await applyProposal(propose({ bestOverall: 'Tool A' }));
    expect(res.held).toEqual([]);
    expect(bestPick()?.pickName).toBe('Tool A');
  });
});

describe('storyEvidenceSince', () => {
  beforeEach(() => useTestDb());

  it('finds curated stories after the cutoff that name any combo part, in title or tl;dr', () => {
    const db = useTestDb();
    db.insert(stories).values({ title: 'old news about Kling', status: 'curated', createdAt: ago(20) }).run();
    db.insert(stories).values({ title: 'raw item about Runway', status: 'raw', createdAt: ago(1) }).run();
    expect(storyEvidenceSince('Runway / Kling', ago(10))).toBe(false);

    db.insert(stories)
      .values({ title: 'Video roundup', tldr: 'Kling 3 tops the arena', status: 'curated', createdAt: ago(2) })
      .run();
    expect(storyEvidenceSince('Runway / Kling', ago(10))).toBe(true);
    expect(storyEvidenceSince('Runway', ago(10))).toBe(false);
  });

  it('treats LIKE wildcards in a pick name literally', () => {
    const db = useTestDb();
    db.insert(stories).values({ title: 'abcdef', status: 'curated', createdAt: ago(1) }).run();
    expect(storyEvidenceSince('a%f', ago(10))).toBe(false);
  });
});
