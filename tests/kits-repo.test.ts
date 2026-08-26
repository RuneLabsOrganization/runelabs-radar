import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { kitPicks, kitPickHistory } from '@/lib/db/schema';
import { getKitPersona } from '@/lib/kits/personas';
import { loadKit, loadPicks, getPickCell, loadKitPickHistory } from '@/lib/kits/repo';

describe('kit_picks table', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('stores one row per (category, task, tier)', () => {
    db.insert(kitPicks)
      .values({
        category: 'video',
        task: 'text-to-video',
        tier: 'cheapest',
        pickName: 'Example',
        priceModel: 'seat',
        priceUsdMonth: 20,
        confidence: 'high',
        evidenceCount: 34,
        distinctSources: 4,
        verifiedAt: new Date('2026-08-23T00:00:00Z'),
        updatedAt: new Date('2026-08-23T00:00:00Z'),
      })
      .run();
    const rows = db.select().from(kitPicks).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].pickName).toBe('Example');
    expect(rows[0].priceModel).toBe('seat');
  });

  it('rejects a duplicate cell+tier', () => {
    const row = {
      category: 'video',
      task: 'text-to-video',
      tier: 'cheapest' as const,
      pickName: 'A',
      updatedAt: new Date(),
    };
    db.insert(kitPicks).values(row).run();
    expect(() => db.insert(kitPicks).values({ ...row, pickName: 'B' }).run()).toThrow();
  });
});

describe('kit repo', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    db.insert(kitPicks)
      .values([
        {
          category: 'video',
          task: 'text-to-video',
          tier: 'cheapest',
          pickName: 'VidThing',
          priceModel: 'seat',
          priceUsdMonth: 20,
          confidence: 'high',
          evidenceCount: 34,
          distinctSources: 4,
          verifiedAt: new Date('2026-08-23T00:00:00Z'),
          updatedAt: new Date('2026-08-23T00:00:00Z'),
        },
        {
          category: 'audio',
          task: 'voice-tts',
          tier: 'cheapest',
          pickName: 'VoiceThing',
          priceModel: 'usage',
          priceUsdMonth: 99,
          riskFlag: 'metered per character',
          confidence: 'med',
          evidenceCount: 8,
          distinctSources: 2,
          verifiedAt: new Date('2026-08-20T00:00:00Z'),
          updatedAt: new Date('2026-08-20T00:00:00Z'),
        },
      ])
      .run();
  });

  it('loads picks for a set of cells', () => {
    const picks = loadPicks([{ category: 'video', task: 'text-to-video' }], 'cheapest');
    expect(picks).toHaveLength(1);
    expect(picks[0].pickName).toBe('VidThing');
    expect(picks[0].verifiedAt).toBeInstanceOf(Date);
  });

  it('composes a kit from the database', () => {
    const kit = loadKit(getKitPersona('ugc-creator')!, 'cheapest');
    expect(kit.coveredCount).toBe(2);
    expect(kit.totalUsdMonth).toBe(20); // usage-priced voice excluded
    expect(kit.usageRisk).toHaveLength(1);
    expect(kit.gaps).toHaveLength(4);
  });

  it('returns a single cell or null', () => {
    expect(getPickCell('video', 'text-to-video', 'cheapest')?.pickName).toBe('VidThing');
    expect(getPickCell('video', 'avatar', 'cheapest')).toBeNull();
  });
});

describe('loadKitPickHistory', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    const now = Date.now();
    db.insert(kitPickHistory)
      .values([
        {
          category: 'video',
          task: 'text-to-video',
          tier: 'best',
          fromPick: 'Old',
          toPick: 'New',
          reason: 'board proposal approved',
          changedAt: new Date(now - 2 * 864e5),
        },
        {
          category: 'coding',
          task: 'autocomplete',
          tier: 'value',
          fromPick: null,
          toPick: 'First',
          reason: 'board proposal approved',
          changedAt: new Date(now - 60 * 864e5),
        },
      ])
      .run();
  });

  it('returns changes inside the window, newest first', () => {
    const rows = loadKitPickHistory({ days: 30 });
    expect(rows).toHaveLength(1);
    expect(rows[0].toPick).toBe('New');
    expect(rows[0].fromPick).toBe('Old');
    expect(rows[0].task).toBe('text-to-video');
  });

  it('filters to the given persona cells', () => {
    const persona = getKitPersona('ugc-creator')!;
    const rows = loadKitPickHistory({ days: 90, cells: persona.routes });
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('video');
  });

  it('keeps a first pick (fromPick null) when it is in the window', () => {
    const rows = loadKitPickHistory({ days: 90 });
    expect(rows).toHaveLength(2);
    expect(rows[0].toPick).toBe('New');
    expect(rows[1].fromPick).toBeNull();
    expect(rows[1].toPick).toBe('First');
  });

  it('returns nothing when the window is empty', () => {
    expect(loadKitPickHistory({ days: 1 })).toHaveLength(0);
  });
});
