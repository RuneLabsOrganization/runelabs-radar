import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useTestDb } from './helpers/db';
import { benchmarkSnapshots } from '@/lib/db/schema';
import { recordMetrics } from '@/lib/metrics';
import { getDb } from '@/lib/db';
import { aaModels, marketModels, normalizeModelKey } from '@/lib/analytics';

function seedAaSnapshot(models: Record<string, unknown>[]): void {
  getDb()
    .insert(benchmarkSnapshots)
    .values({ source: 'artificial-analysis', raw: JSON.stringify({ compact: true, models }), fetchedAt: new Date() })
    .run();
}

const savedKey = process.env.AA_API_KEY;

beforeEach(() => {
  useTestDb();
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.AA_API_KEY;
  else process.env.AA_API_KEY = savedKey;
});

describe('normalizeModelKey', () => {
  it('folds vendor prefixes, case and punctuation so sources collide', () => {
    expect(normalizeModelKey('openai/gpt-5.5')).toBe('gpt55');
    expect(normalizeModelKey('GPT-5.5')).toBe('gpt55');
    expect(normalizeModelKey('anthropic/claude-sonnet-4.5')).toBe(normalizeModelKey('Claude Sonnet 4.5'));
    expect(normalizeModelKey('MiniMax-M2')).toBe(normalizeModelKey('minimax m2'));
  });

  it('keeps OpenRouter variant suffixes as distinct SKUs', () => {
    expect(normalizeModelKey('openai/gpt-5.5:free')).not.toBe(normalizeModelKey('openai/gpt-5.5'));
  });
});

describe('merged first-party market reader (§6d)', () => {
  it('assembles the AaModel shape from open-bench + provider-pricing (3:1 blend)', () => {
    recordMetrics([
      { source: 'open-bench', entity: 'GPT-5.5', metric: 'intelligence', value: 68 },
      { source: 'provider-pricing', entity: 'GPT-5.5', metric: 'price_in', value: 10 },
      { source: 'provider-pricing', entity: 'GPT-5.5', metric: 'price_out', value: 15 },
      { source: 'radar-speed', entity: 'GPT-5.5', metric: 'output_toks_per_s', value: 42.5 },
    ]);
    const res = marketModels();
    expect(res).not.toBeNull();
    expect(res!.models).toHaveLength(1);
    expect(res!.models[0]).toMatchObject({
      name: 'GPT-5.5',
      source: 'first_party',
      intelligence: 68,
      priceIn: 10,
      priceOut: 15,
      price: (3 * 10 + 15) / 4, // 11.25 — AA-convention 3:1 blend
      speed: 42.5,
      coding: null,
      org: null,
      released: null,
    });
  });

  it('joins OpenRouter ids onto display names and prefers provider-pricing per field', () => {
    recordMetrics([
      { source: 'open-bench', entity: 'Claude Sonnet 4.5', metric: 'intelligence', value: 55 },
      { source: 'openrouter', entity: 'anthropic/claude-sonnet-4.5', metric: 'price_in', value: 3 },
      { source: 'openrouter', entity: 'anthropic/claude-sonnet-4.5', metric: 'price_out', value: 15 },
      // provider-pricing wins over openrouter for the same field
      { source: 'provider-pricing', entity: 'Claude Sonnet 4.5', metric: 'price_in', value: 3.5 },
    ]);
    const res = marketModels();
    expect(res!.models).toHaveLength(1);
    expect(res!.models[0]).toMatchObject({
      name: 'Claude Sonnet 4.5',
      source: 'first_party',
      priceIn: 3.5, // provider-pricing, not the openrouter 3
      priceOut: 15, // openrouter fills the gap
      price: (3 * 3.5 + 15) / 4,
    });
  });

  it('covers only models with BOTH capability and price signals', () => {
    recordMetrics([
      { source: 'open-bench', entity: 'NoPrice Model', metric: 'intelligence', value: 50 },
      { source: 'provider-pricing', entity: 'NoCap Model', metric: 'price_in', value: 1 },
      { source: 'provider-pricing', entity: 'NoCap Model', metric: 'price_out', value: 2 },
    ]);
    expect(marketModels()).toBeNull();
  });

  it('media/livebench metric keys are NOT capability evidence (§6b note)', () => {
    recordMetrics([
      { source: 'open-bench', entity: 'Imagen 4 Ultra', metric: 'image_elo', value: 1284 },
      { source: 'open-bench', entity: 'Imagen 4 Ultra', metric: 'livebench', value: 61 },
      { source: 'provider-pricing', entity: 'Imagen 4 Ultra', metric: 'price_in', value: 1 },
    ]);
    expect(marketModels()).toBeNull();
  });

  it('elo-only models get a cohort min-max 0-100 capability index', () => {
    recordMetrics([
      { source: 'open-bench', entity: 'EloHi', metric: 'elo', value: 1450 },
      { source: 'open-bench', entity: 'EloLo', metric: 'elo', value: 1400 },
      { source: 'provider-pricing', entity: 'EloHi', metric: 'price_in', value: 5 },
      { source: 'provider-pricing', entity: 'EloLo', metric: 'price_in', value: 1 },
      // an intelligence model in the same DB must not disturb the elo mapping
      { source: 'open-bench', entity: 'Intel Model', metric: 'intelligence', value: 60 },
      { source: 'provider-pricing', entity: 'Intel Model', metric: 'price_in', value: 2 },
    ]);
    const res = marketModels();
    const byName = new Map(res!.models.map((m) => [m.name, m]));
    expect(byName.get('EloHi')!.intelligence).toBe(100);
    expect(byName.get('EloLo')!.intelligence).toBe(0);
    expect(byName.get('Intel Model')!.intelligence).toBe(60);
    expect(byName.get('Intel Model')!.source).toBe('first_party');
  });

  it('first-party coverage beats the AA row for the same model; uncovered models fall back to AA', () => {
    process.env.AA_API_KEY = 'test-key';
    recordMetrics([
      { source: 'open-bench', entity: 'GPT-5.5', metric: 'intelligence', value: 68 },
      { source: 'provider-pricing', entity: 'GPT-5.5', metric: 'price_in', value: 10 },
      { source: 'provider-pricing', entity: 'GPT-5.5', metric: 'price_out', value: 15 },
    ]);
    seedAaSnapshot([
      { name: 'GPT-5.5', org: 'OpenAI', intelligence: 35.4, coding: 30, price: 11.25, priceIn: 10, priceOut: 15, speed: 80, released: null },
      { name: 'MiniMax M2', org: 'MiniMax', intelligence: 30, coding: null, price: 2, priceIn: 1, priceOut: 3, speed: 92.1, released: null },
    ]);
    const res = marketModels();
    const byName = new Map(res!.models.map((m) => [m.name, m]));
    // covered by first-party → NOT the AA values, even though AA lists it
    expect(byName.get('GPT-5.5')).toMatchObject({ source: 'first_party', intelligence: 68, speed: null });
    // no first-party coverage → AA backstop with the key set
    expect(byName.get('MiniMax M2')).toMatchObject({ source: 'artificial_analysis', intelligence: 30, speed: 92.1 });
  });

  it('keeps serving the stored AA snapshot for uncovered models when the key is unset (backstop policy)', () => {
    delete process.env.AA_API_KEY;
    recordMetrics([
      { source: 'open-bench', entity: 'GPT-5.5', metric: 'intelligence', value: 68 },
      { source: 'provider-pricing', entity: 'GPT-5.5', metric: 'price_in', value: 10 },
    ]);
    seedAaSnapshot([
      { name: 'MiniMax M2', org: 'MiniMax', intelligence: 30, coding: null, price: 2, priceIn: 1, priceOut: 3, speed: null, released: null },
    ]);
    const res = marketModels();
    const byName = new Map(res!.models.map((m) => [m.name, m]));
    expect(byName.get('GPT-5.5')!.source).toBe('first_party');
    // a stored snapshot means AA was configured at fetch time — it backstops
    // uncovered models during the transition (matches runBoardSync's policy)
    expect(byName.get('MiniMax M2')!.source).toBe('artificial_analysis');
  });

  it('no key and no snapshot: uncovered models are absent', () => {
    delete process.env.AA_API_KEY;
    recordMetrics([
      { source: 'open-bench', entity: 'GPT-5.5', metric: 'intelligence', value: 68 },
      { source: 'provider-pricing', entity: 'GPT-5.5', metric: 'price_in', value: 10 },
      { source: 'open-bench', entity: 'Uncovered Model', metric: 'intelligence', value: 40 },
    ]);
    const res = marketModels();
    expect(res!.models).toHaveLength(1);
    expect(res!.models[0]!.name).toBe('GPT-5.5');
  });

  it('aaModels keeps the pre-§6d shape over the merged data', () => {
    recordMetrics([
      { source: 'open-bench', entity: 'GPT-5.5', metric: 'intelligence', value: 68 },
      { source: 'provider-pricing', entity: 'GPT-5.5', metric: 'price_in', value: 10 },
    ]);
    seedAaSnapshot([
      { name: 'MiniMax M2', org: 'MiniMax', intelligence: 70, coding: null, price: 2, priceIn: 1, priceOut: 3, speed: 92.1, released: null },
    ]);
    const res = aaModels();
    expect(res).not.toBeNull();
    expect(res!.models).toHaveLength(2);
    // sorted by intelligence desc across the merge
    expect(res!.models[0]!.name).toBe('MiniMax M2');
    expect(res!.models[1]!.name).toBe('GPT-5.5');
    expect(typeof res!.fetchedAt).toBe('string');
  });

  it('uses the latest value per series, not older history', () => {
    recordMetrics([
      { source: 'open-bench', entity: 'GPT-5.5', metric: 'intelligence', value: 40, date: '2026-08-01' },
      { source: 'open-bench', entity: 'GPT-5.5', metric: 'intelligence', value: 68 },
      { source: 'provider-pricing', entity: 'GPT-5.5', metric: 'price_in', value: 99, date: '2026-08-01' },
      { source: 'provider-pricing', entity: 'GPT-5.5', metric: 'price_in', value: 10 },
    ]);
    const res = marketModels();
    expect(res!.models[0]).toMatchObject({ intelligence: 68, priceIn: 10 });
  });
});
