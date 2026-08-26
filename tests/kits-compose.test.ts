import { describe, it, expect } from 'vitest';
import { composeKit, type PickRecord } from '@/lib/kits/compose';
import { KIT_PERSONAS, getKitPersona } from '@/lib/kits/personas';
import { KIT_TIERS } from '@/lib/kits/grid';

function pick(over: Partial<PickRecord> & Pick<PickRecord, 'category' | 'task'>): PickRecord {
  return {
    tier: 'cheapest',
    pickName: 'Thing',
    pickUrl: null,
    priceModel: 'seat',
    priceUsdMonth: 10,
    priceNote: null,
    riskFlag: null,
    why: null,
    skip: null,
    confidence: 'high',
    evidenceCount: 30,
    verifiedAt: new Date('2026-08-24T00:00:00Z'),
    ...over,
  };
}

const UGC = getKitPersona('ugc-creator')!;

describe('composeKit', () => {
  it('totals seat-priced picks and counts coverage', () => {
    const kit = composeKit(UGC, 'cheapest', [
      pick({ category: 'video', task: 'text-to-video', priceUsdMonth: 20 }),
      pick({ category: 'audio', task: 'voice-tts', priceUsdMonth: 12 }),
    ]);
    expect(kit.totalUsdMonth).toBe(32);
    expect(kit.coveredCount).toBe(2);
    expect(kit.totalCount).toBe(6);
  });

  it('counts free picks as zero', () => {
    const kit = composeKit(UGC, 'cheapest', [
      pick({ category: 'audio', task: 'music', priceModel: 'free', priceUsdMonth: null }),
    ]);
    expect(kit.totalUsdMonth).toBe(0);
    expect(kit.coveredCount).toBe(1);
  });

  // INVARIANT 1 — usage-priced picks never enter the total.
  it('excludes usage-priced picks from the total and lists them as risk', () => {
    const kit = composeKit(UGC, 'cheapest', [
      pick({ category: 'video', task: 'text-to-video', priceUsdMonth: 20 }),
      pick({
        category: 'audio',
        task: 'voice-tts',
        priceModel: 'usage',
        priceUsdMonth: 999,
        riskFlag: 'no spend cap by default',
      }),
    ]);
    expect(kit.totalUsdMonth).toBe(20);
    expect(kit.usageRisk).toHaveLength(1);
    expect(kit.usageRisk[0].riskFlag).toBe('no spend cap by default');
    // still rendered as a line — excluded from the total, not hidden
    expect(kit.lines.find((l) => l.task === 'voice-tts')?.pick).not.toBeNull();
  });

  // INVARIANT 2 — gaps are reported, never back-filled.
  it('reports missing cells as gaps with a null pick', () => {
    const kit = composeKit(UGC, 'cheapest', [
      pick({ category: 'video', task: 'text-to-video' }),
    ]);
    expect(kit.gaps).toHaveLength(5);
    expect(kit.lines).toHaveLength(6);
    expect(kit.lines.filter((l) => l.pick === null)).toHaveLength(5);
  });

  it('only matches picks of the requested tier', () => {
    const kit = composeKit(UGC, 'cheapest', [
      pick({ category: 'video', task: 'text-to-video', tier: 'best' }),
    ]);
    expect(kit.coveredCount).toBe(0);
    expect(kit.gaps).toHaveLength(6);
  });

  it('drops excluded cells from lines and gaps alike', () => {
    const kit = composeKit(UGC, 'cheapest', [], { exclude: ['audio/music', 'audio/voice-tts'] });
    expect(kit.lines).toHaveLength(4);
    expect(kit.totalCount).toBe(4);
    expect(kit.gaps).toHaveLength(4);
  });

  it('preserves persona route order', () => {
    const kit = composeKit(UGC, 'cheapest', []);
    expect(kit.lines.map((l) => `${l.category}/${l.task}`)).toEqual(
      UGC.routes.map((r) => `${r.category}/${r.task}`),
    );
  });

  // INVARIANT 3 — the whole roster composes against an empty grid.
  it('every persona and tier composes with no picks at all', () => {
    for (const p of KIT_PERSONAS) {
      for (const tier of KIT_TIERS) {
        const kit = composeKit(p, tier, []);
        expect(kit.lines).toHaveLength(p.routes.length);
        expect(kit.gaps).toHaveLength(p.routes.length);
        expect(kit.totalUsdMonth).toBe(0);
        expect(kit.coveredCount).toBe(0);
      }
    }
  });
});
