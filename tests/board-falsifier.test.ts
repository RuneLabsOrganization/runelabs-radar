import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { boardProposals, kitPicks, verdictClaims } from '@/lib/db/schema';
import { chatJSON } from '@/lib/llm/minimax';
import { applyProposal, parseFalsifiers, pickFalsifiers } from '@/lib/board/apply';
import { runBoardSync } from '@/lib/board/sync';
import { buildClaim, MAX_FALSIFIER_CHARS, normalizeFalsifier, UNREGISTERED } from '@/lib/kits/claims';
import { openClaimFor } from '@/lib/kits/claims-repo';
import { falsifierCoverage } from '@/lib/science/verdict-accuracy';

vi.mock('@/lib/llm/minimax', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/minimax')>();
  return { ...actual, chatJSON: vi.fn() };
});
const mockChat = chatJSON as unknown as Mock;

const CELL = { category: 'coding', task: 'agentic-coding' } as const;

describe('normalizeFalsifier / buildClaim', () => {
  it('collapses whitespace and control characters, and keeps the text otherwise verbatim', () => {
    expect(normalizeFalsifier('  An existing tool\n\tbeats it\u0000 on SWE-bench  ')).toBe(
      'An existing tool beats it on SWE-bench',
    );
  });

  it('caps a runaway falsifier', () => {
    const long = normalizeFalsifier('x'.repeat(MAX_FALSIFIER_CHARS * 2))!;
    expect(long.length).toBe(MAX_FALSIFIER_CHARS);
    expect(long.endsWith('…')).toBe(true);
  });

  it('never invents one: empty, non-string or the literal sentinel stay unregistered', () => {
    for (const v of [undefined, '', '   ', 42, null, 'Unregistered']) {
      expect(normalizeFalsifier(v)).toBeUndefined();
    }
    expect(buildClaim({ ...CELL, tier: 'best', pickName: 'X', falsifier: '  ' }).falsifier).toBe(UNREGISTERED);
    expect(buildClaim({ ...CELL, tier: 'best', pickName: 'X', falsifier: ' it loses ' }).falsifier).toBe('it loses');
  });
});

describe('falsifiers in the proposal JSON', () => {
  it('pickFalsifiers keeps one per pick the proposal sets, and drops the rest', () => {
    const picks = { bestOverall: 'A', bestValue: null, cheapestViable: 'C' };
    expect(
      pickFalsifiers({ bestOverall: 'A loses on X', bestValue: 'orphan', cheapestViable: '' }, picks),
    ).toEqual({ bestOverall: 'A loses on X' });
    expect(pickFalsifiers('one for all', picks)).toEqual({ bestOverall: 'one for all', cheapestViable: 'one for all' });
    expect(pickFalsifiers(undefined, picks)).toEqual({});
    expect(pickFalsifiers(['nope'], picks)).toEqual({});
  });

  it('parseFalsifiers reads the per-tier object, a single string, and survives junk', () => {
    expect(parseFalsifiers(JSON.stringify({ falsifiers: { bestValue: 'v' } }))).toEqual({ bestValue: 'v' });
    expect(parseFalsifiers(JSON.stringify({ falsifiers: 's' }))).toEqual({
      bestOverall: 's',
      bestValue: 's',
      cheapestViable: 's',
    });
    expect(parseFalsifiers(JSON.stringify({ bestOverall: 'A' }))).toEqual({});
    expect(parseFalsifiers('{not json')).toEqual({});
  });
});

describe('applyProposal threads the stated falsifier into the claim', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('opens each tier with its own falsifier and leaves a tier without one unregistered', async () => {
    const id = db
      .insert(boardProposals)
      .values({
        domain: 'coding',
        task: 'agentic-coding',
        proposed: JSON.stringify({
          bestOverall: 'Tool A',
          bestValue: 'Tool V',
          falsifiers: { bestOverall: 'Tool B already scores higher on SWE-bench at the same price' },
        }),
        rationale: 'r',
        status: 'pending',
        createdAt: new Date(),
      })
      .returning({ id: boardProposals.id })
      .get().id;

    await applyProposal(id);

    expect(openClaimFor({ ...CELL, tier: 'best' })?.falsifier).toBe(
      'Tool B already scores higher on SWE-bench at the same price',
    );
    expect(openClaimFor({ ...CELL, tier: 'value' })?.falsifier).toBe(UNREGISTERED);
    expect(falsifierCoverage()).toEqual({ registered: 1, open: 2, pct: 50 });
  });
});

describe('runBoardSync: the generator states falsifiers and one change per cell per run', () => {
  let db: Db;
  const savedAa = process.env.AA_API_KEY;
  const savedAuto = process.env.BOARD_AUTO_APPLY;

  beforeEach(() => {
    db = useTestDb();
    delete process.env.AA_API_KEY;
    delete process.env.BOARD_AUTO_APPLY;
    mockChat.mockReset();
  });
  afterEach(() => {
    if (savedAa === undefined) delete process.env.AA_API_KEY;
    else process.env.AA_API_KEY = savedAa;
    if (savedAuto === undefined) delete process.env.BOARD_AUTO_APPLY;
    else process.env.BOARD_AUTO_APPLY = savedAuto;
  });

  it('asks for falsifiers, keeps the first proposal per task, and registers its falsifier on the claim', async () => {
    mockChat.mockImplementation(async (_system: string, user: string) => {
      if (!user.startsWith('Domain: coding')) return { proposals: [] };
      return {
        proposals: [
          {
            task: 'agentic-coding',
            bestOverall: 'Tool A',
            rationale: 'leads the coding index',
            falsifiers: { bestOverall: 'An available agent beats Tool A on SWE-bench Verified at <= its price' },
          },
          // same task again in the same response — used to apply right after the first
          { task: 'agentic-coding', bestOverall: 'Tool B', rationale: 'changed my mind' },
          { task: 'autocomplete', bestOverall: 'Tab X', rationale: 'fast' },
        ],
      };
    });

    const res = await runBoardSync();

    const system = mockChat.mock.calls[0][0] as string;
    expect(system).toContain('"falsifiers"');
    expect(res.proposals).toBe(2);

    const props = db.select().from(boardProposals).where(eq(boardProposals.task, 'agentic-coding')).all();
    expect(props).toHaveLength(1);
    expect(props[0].status).toBe('approved');

    const pick = db.select().from(kitPicks).where(eq(kitPicks.task, 'agentic-coding')).get();
    expect(pick?.pickName).toBe('Tool A');
    expect(openClaimFor({ ...CELL, tier: 'best' })?.falsifier).toBe(
      'An available agent beats Tool A on SWE-bench Verified at <= its price',
    );
    // the autocomplete proposal stated none — honest gap, not a generated one
    expect(openClaimFor({ category: 'coding', task: 'autocomplete', tier: 'best' })?.falsifier).toBe(UNREGISTERED);
    expect(db.select().from(verdictClaims).all()).toHaveLength(2);
  });

  it('a rerun the same day cannot flip the cell back (damped auto-apply)', async () => {
    let pick = 'Tool A';
    mockChat.mockImplementation(async (_s: string, user: string) =>
      user.startsWith('Domain: coding')
        ? { proposals: [{ task: 'agentic-coding', bestOverall: pick, rationale: 'r' }] }
        : { proposals: [] },
    );
    await runBoardSync();
    pick = 'Tool B';
    await runBoardSync();
    pick = 'Tool A';
    await runBoardSync();

    const current = db.select().from(kitPicks).where(eq(kitPicks.task, 'agentic-coding')).get();
    expect(current?.pickName).toBe('Tool A'); // the first pick stands; both later flips were held
    expect(db.select().from(verdictClaims).all()).toHaveLength(1);
  });
});
