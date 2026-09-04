import { beforeEach, describe, expect, it } from 'vitest';
import { boardHistory, stories } from '@/lib/db/schema';
import { freshnessStats } from '@/lib/freshness';
import { useTestDb } from './helpers/db';

const NOW = new Date('2026-08-20T00:00:00Z');
const H = 3_600_000;
const MIN = 60_000;

function addStory(
  db: ReturnType<typeof useTestDb>,
  opts: {
    title: string;
    entities?: { name: string; kind: string }[] | string | null;
    createdAt: Date;
    updatedAt?: Date | null;
    status?: 'raw' | 'curated' | 'filtered';
  },
) {
  const entities =
    typeof opts.entities === 'string' || opts.entities == null
      ? (opts.entities ?? null)
      : JSON.stringify(opts.entities);
  db.insert(stories)
    .values({
      title: opts.title,
      status: opts.status ?? 'curated',
      topScore: 80,
      entities,
      createdAt: opts.createdAt,
      updatedAt: opts.updatedAt ?? null,
    })
    .run();
}

function addBoardChange(db: ReturnType<typeof useTestDb>, change: string, appliedAt: Date) {
  db.insert(boardHistory).values({ domain: 'coding', task: 'codegen', change, appliedAt }).run();
}

describe('freshnessStats — board reflection', () => {
  beforeEach(() => {
    useTestDb();
  });

  it('matches a board change containing a story entity (case-insensitive) and measures the lag', () => {
    const db = useTestDb();
    const createdAt = new Date(NOW.getTime() - 10 * H);
    addStory(db, {
      title: 'GPT-6 launches',
      entities: [{ name: 'GPT-6', kind: 'model' }],
      createdAt,
    });
    addBoardChange(db, 'bestOverall: GPT-5 -> gpt-6', new Date(createdAt.getTime() + 4 * H));
    const { boardReflection } = freshnessStats(NOW);
    expect(boardReflection.considered).toBe(1);
    expect(boardReflection.matched).toBe(1);
    expect(boardReflection.medianHours).toBe(4);
    expect(boardReflection.pairs[0]).toMatchObject({
      storyTitle: 'GPT-6 launches',
      entity: 'gpt-6',
      lagHours: 4,
    });
  });

  it('matches any of several entities and reports the one that hit', () => {
    const db = useTestDb();
    const createdAt = new Date(NOW.getTime() - 20 * H);
    addStory(db, {
      title: 'Claude Code pricing shift',
      entities: [
        { name: 'Anthropic', kind: 'org' },
        { name: 'Claude Code', kind: 'tool' },
      ],
      createdAt,
    });
    addBoardChange(db, 'cheapestViable: (none) -> CLAUDE CODE max', new Date(createdAt.getTime() + 6 * H));
    const { boardReflection } = freshnessStats(NOW);
    expect(boardReflection.matched).toBe(1);
    expect(boardReflection.pairs[0]!.entity).toBe('claude code');
  });

  it('median over matched pairs (odd and even counts)', () => {
    const db = useTestDb();
    const base = NOW.getTime() - 100 * H;
    // lags: 2h, 10h, 4h → median 4
    const lags = [2, 10, 4];
    lags.forEach((lag, i) => {
      const createdAt = new Date(base + i * MIN);
      addStory(db, { title: `story ${i}`, entities: [{ name: `Model${i}`, kind: 'model' }], createdAt });
      addBoardChange(db, `bestOverall: old -> Model${i}`, new Date(createdAt.getTime() + lag * H));
    });
    expect(freshnessStats(NOW).boardReflection.medianHours).toBe(4);
    // add a 12h lag → lags 2, 4, 10, 12 → median 7
    const createdAt = new Date(base + 3 * MIN);
    addStory(db, { title: 'story 3', entities: [{ name: 'Model3', kind: 'model' }], createdAt });
    addBoardChange(db, 'bestValue: old -> Model3', new Date(createdAt.getTime() + 12 * H));
    expect(freshnessStats(NOW).boardReflection.medianHours).toBe(7);
  });

  it('first match only: an earlier matching change wins and the story counts once', () => {
    const db = useTestDb();
    const createdAt = new Date(NOW.getTime() - 30 * H);
    addStory(db, { title: 'Sora 3 drops', entities: [{ name: 'Sora 3', kind: 'model' }], createdAt });
    addBoardChange(db, 'bestOverall: Sora 2 -> Sora 3', new Date(createdAt.getTime() + 3 * H));
    addBoardChange(db, 'bestValue: Sora 2 -> Sora 3', new Date(createdAt.getTime() + 9 * H));
    const { boardReflection } = freshnessStats(NOW);
    expect(boardReflection.matched).toBe(1);
    expect(boardReflection.pairs).toHaveLength(1);
    expect(boardReflection.medianHours).toBe(3);
  });

  it('ignores board changes applied before the story appeared', () => {
    const db = useTestDb();
    const createdAt = new Date(NOW.getTime() - 10 * H);
    addStory(db, { title: 'Gemini 4', entities: [{ name: 'Gemini 4', kind: 'model' }], createdAt });
    addBoardChange(db, 'bestOverall: Gemini 3 -> Gemini 4', new Date(createdAt.getTime() - 2 * H));
    const { boardReflection } = freshnessStats(NOW);
    expect(boardReflection.matched).toBe(0);
    expect(boardReflection.medianHours).toBeNull();
  });

  it('a 2-char entity name fabricates nothing (E4)', () => {
    const db = useTestDb();
    const createdAt = new Date(NOW.getTime() - 10 * H);
    // "o3" substring-matches any change text containing it incidentally —
    // names < 3 chars are ignored (same bar as hindsight.ts's materialization)
    addStory(db, { title: 'o3 launches', entities: [{ name: 'o3', kind: 'model' }], createdAt });
    addBoardChange(db, 'bestOverall: o3-mini -> o4', new Date(createdAt.getTime() + H));
    const { boardReflection } = freshnessStats(NOW);
    expect(boardReflection.considered).toBe(0);
    expect(boardReflection.matched).toBe(0);
  });

  it('one giant change row is claimed by at most one story — it cannot dominate the median (E4)', () => {
    const db = useTestDb();
    const base = NOW.getTime() - 100 * H;
    // three stories, all "reflected" by the SAME sync row at a ~1h lag
    for (let i = 0; i < 3; i++) {
      addStory(db, {
        title: `story ${i}`,
        entities: [{ name: `SyncModel${i}`, kind: 'model' }],
        createdAt: new Date(base + i * MIN),
      });
    }
    addBoardChange(
      db,
      'bestOverall: x -> SyncModel0 + SyncModel1 + SyncModel2',
      new Date(base + H + 90 * 1000),
    );
    // only the earliest-created story claims the row: 1 pair, not 3 same-lag pairs
    const first = freshnessStats(NOW).boardReflection;
    expect(first.matched).toBe(1);
    expect(first.pairs[0]!.entity).toBe('syncmodel0');

    // with their own rows, the other two stories match independently
    addBoardChange(db, 'bestValue: y -> SyncModel1', new Date(base + MIN + 10 * H));
    addBoardChange(db, 'cheapestViable: z -> SyncModel2', new Date(base + 2 * MIN + 20 * H));
    const all = freshnessStats(NOW).boardReflection;
    expect(all.matched).toBe(3);
    // lags ≈ 1h, 10h, 20h → median 10h — the 1h row no longer triple-votes
    expect(all.medianHours).toBe(10);
  });

  it('excludes stories outside the 90-day window, non-curated stories, and unusable entities', () => {
    const db = useTestDb();
    const inWindow = new Date(NOW.getTime() - 24 * H);
    addStory(db, {
      title: 'too old',
      entities: [{ name: 'OldModel', kind: 'model' }],
      createdAt: new Date(NOW.getTime() - 91 * 24 * H),
    });
    addStory(db, { title: 'raw story', entities: [{ name: 'RawModel', kind: 'model' }], createdAt: inWindow, status: 'raw' });
    addStory(db, { title: 'no entities', entities: null, createdAt: inWindow });
    addStory(db, { title: 'bad json', entities: 'not-json', createdAt: inWindow });
    addBoardChange(db, 'bestOverall: x -> OldModel', new Date(inWindow.getTime() + H));
    addBoardChange(db, 'bestOverall: x -> RawModel', new Date(inWindow.getTime() + H));
    const { boardReflection } = freshnessStats(NOW);
    expect(boardReflection.considered).toBe(0);
    expect(boardReflection.matched).toBe(0);
  });
});

describe('freshnessStats — merge lag', () => {
  beforeEach(() => {
    useTestDb();
  });

  it('median minutes createdAt → updatedAt over merged stories', () => {
    const db = useTestDb();
    const base = NOW.getTime() - 48 * H;
    // lags: 30min, 90min → median 60; unmerged story ignored
    addStory(db, { title: 'a', createdAt: new Date(base), updatedAt: new Date(base + 30 * MIN) });
    addStory(db, { title: 'b', createdAt: new Date(base), updatedAt: new Date(base + 90 * MIN) });
    addStory(db, { title: 'never merged', createdAt: new Date(base) });
    const { mergeLag } = freshnessStats(NOW);
    expect(mergeLag.count).toBe(2);
    expect(mergeLag.medianMinutes).toBe(60);
  });
});

describe('freshnessStats — empty data', () => {
  it('returns nulls and zero counts on an empty database', () => {
    useTestDb();
    const stats = freshnessStats(NOW);
    expect(stats.boardReflection.medianHours).toBeNull();
    expect(stats.boardReflection.matched).toBe(0);
    expect(stats.boardReflection.considered).toBe(0);
    expect(stats.boardReflection.pairs).toEqual([]);
    expect(stats.mergeLag.medianMinutes).toBeNull();
    expect(stats.mergeLag.count).toBe(0);
  });
});
