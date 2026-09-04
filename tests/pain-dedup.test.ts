import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { _setFetch } from '@/lib/llm/minimax';
import { items, painPoints, sources } from '@/lib/db/schema';
import { COMP_AMOUNT_CAP_USD, PAIN_MERGE_THRESHOLD, runPain, sanitizeComps, sightingWeight } from '@/lib/pain';
import { useTestDb } from './helpers/db';

const USAGE = { prompt_tokens: 10, completion_tokens: 5 };

function llmOk(payload: unknown): Response {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: USAGE }),
  } as Response;
}

/** Unit-ish vector: one hot dimension — identical seeds collide at cosine 1. */
function vec(seed: number): Float32Array {
  const v = new Float32Array(384).fill(0);
  v[seed % 384] = 1;
  return v;
}

function seedDiscussion(n: number): void {
  const db = getDb();
  const sourceId = db
    .insert(sources)
    .values({ type: 'reddit', name: 'r-test', config: '{}' })
    .returning({ id: sources.id })
    .get().id;
  for (let i = 0; i < n; i++) {
    db.insert(items)
      .values({
        sourceId,
        url: `https://reddit.com/r/test/${i}`,
        title: `discussion item ${i} about missing tools`,
        excerpt: null,
        fetchedAt: new Date(),
      })
      .run();
  }
}

function seedPain(summary: string, intensity = 1): number {
  return getDb()
    .insert(painPoints)
    .values({ summary, sector: null, intensity, evidence: '[]', lastSeenAt: new Date(), createdAt: new Date() })
    .returning({ id: painPoints.id })
    .get().id;
}

beforeEach(() => {
  useTestDb();
  // chatJSON refuses to call out without a key; the fetch below is mocked anyway
  vi.stubEnv('MINIMAX_API_KEY', 'test-key');
});

afterEach(() => {
  _setFetch(globalThis.fetch);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('runPain paraphrase re-sighting (E5)', () => {
  it('an LLM paraphrase increments the existing row instead of fragmenting a new one', async () => {
    seedDiscussion(1);
    seedPain('Need a tool that batches image resize');
    _setFetch((async () =>
      llmOk({ pains: [{ summary: 'Tool for batch image resizing', itemIndexes: [0] }] })) as unknown as typeof fetch);

    // every summary embeds to the same direction — a paraphrase at cosine ~1
    const out = await runPain({ embed: async (texts) => texts.map(() => vec(1)) });

    const rows = getDb().select().from(painPoints).all();
    expect(rows).toHaveLength(1); // no new fragmented row
    expect(rows[0].summary).toBe('Need a tool that batches image resize');
    expect(rows[0].intensity).toBe(1 + sightingWeight(1));
    expect(JSON.parse(rows[0].evidence)).toHaveLength(1); // new evidence merged in
    expect(out.pains).toBe(1);
  });

  it('a paraphrase below the bar still creates a new row', async () => {
    seedDiscussion(1);
    seedPain('Need a tool that batches image resize');
    _setFetch((async () =>
      llmOk({ pains: [{ summary: 'Automate podcast clipping into shorts', itemIndexes: [0] }] })) as unknown as typeof fetch);

    // orthogonal vectors: cosine 0 < PAIN_MERGE_THRESHOLD
    await runPain({ embed: async (texts) => texts.map((t) => (t.includes('podcast') ? vec(2) : vec(1))) });

    expect(getDb().select().from(painPoints).all()).toHaveLength(2);
  });

  it('two different paraphrases of the same pain in one run both land (no lost update)', async () => {
    seedDiscussion(2);
    seedPain('Need a tool that batches image resize');
    _setFetch((async () =>
      llmOk({
        pains: [
          { summary: 'Tool for batch image resizing', itemIndexes: [0] },
          { summary: 'Bulk resize images automatically', itemIndexes: [1] },
        ],
      })) as unknown as typeof fetch);

    // both paraphrases embed to the same direction as the known pain
    const out = await runPain({ embed: async (texts) => texts.map(() => vec(1)) });

    const rows = getDb().select().from(painPoints).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].intensity).toBe(1 + 2 * sightingWeight(1));
    expect(JSON.parse(rows[0].evidence)).toHaveLength(2);
    expect(out.pains).toBe(2);
  });

  it('the exact-match fast path never pays for embeddings (daily-job budget)', async () => {
    seedDiscussion(1);
    seedPain('Need a tool that batches image resize');
    _setFetch((async () =>
      llmOk({ pains: [{ summary: 'Need a tool that batches image resize', itemIndexes: [0] }] })) as unknown as typeof fetch);

    let embedCalls = 0;
    await runPain({
      embed: async (texts) => {
        embedCalls++;
        return texts.map(() => vec(1));
      },
    });

    expect(embedCalls).toBe(0);
    expect(getDb().select().from(painPoints).get()!.intensity).toBe(1 + sightingWeight(1));
  });

  it('exact duplicates stay idempotent across runs — same row, no re-embedding', async () => {
    seedDiscussion(1);
    const payload = { pains: [{ summary: 'Need a tool that batches image resize', itemIndexes: [0] }] };
    _setFetch((async () => llmOk(payload)) as unknown as typeof fetch);

    let embedCalls = 0;
    const embed = async (texts: string[]): Promise<Float32Array[]> => {
      embedCalls++;
      return texts.map(() => vec(1));
    };
    await runPain({ embed }); // first sighting: new row
    const callsAfterFirst = embedCalls;
    await runPain({ embed }); // second sighting: exact match on the existing row

    const rows = getDb().select().from(painPoints).all();
    expect(rows).toHaveLength(1);
    // run 1 inserted with intensity 1; run 2's exact re-sighting bumped it once
    expect(rows[0].intensity).toBe(1 + sightingWeight(1));
    expect(embedCalls).toBe(callsAfterFirst); // no embeddings spent on the re-run
  });
});

describe('sightingWeight — more evidence weighs more, capped (E5)', () => {
  it('scales with evidence breadth and caps', () => {
    expect(sightingWeight(0)).toBe(1); // a bare sighting still counts
    expect(sightingWeight(1)).toBe(2);
    expect(sightingWeight(5)).toBe(3); // 1 + log1p(5) ≈ 2.8
    expect(sightingWeight(50)).toBe(3); // capped
  });

  it('a 5-item sighting bumps intensity by 3, a zero-index sighting by 1', async () => {
    seedDiscussion(5);
    seedPain('evidence rich pain');
    seedPain('evidence poor pain');
    _setFetch((async () =>
      llmOk({
        pains: [
          { summary: 'evidence rich pain', itemIndexes: [0, 1, 2, 3, 4] },
          { summary: 'evidence poor pain' },
        ],
      })) as unknown as typeof fetch);

    await runPain();

    const rows = getDb().select().from(painPoints).all();
    expect(rows.find((r) => r.summary === 'evidence rich pain')!.intensity).toBe(4);
    expect(rows.find((r) => r.summary === 'evidence poor pain')!.intensity).toBe(2);
  });
});

describe('comps cap is single-sourced (E13)', () => {
  it('aligns at $100M and rejects a $150M exit', () => {
    expect(COMP_AMOUNT_CAP_USD).toBe(100_000_000);
    const out = sanitizeComps([
      { kind: 'exit', product: 'BigCorp Target', amountUsd: 150_000_000 },
      { kind: 'exit', product: 'Small Product', amountUsd: 50_000_000 },
      { kind: 'exit', product: 'Edge Product', amountUsd: COMP_AMOUNT_CAP_USD + 1 },
    ]);
    // the $150M and cap+1 amounts are rejected (amount nulled); $50M survives
    expect(out.find((c) => c.product === 'BigCorp Target')!.amountUsd).toBeNull();
    expect(out.find((c) => c.product === 'Edge Product')!.amountUsd).toBeNull();
    expect(out.find((c) => c.product === 'Small Product')!.amountUsd).toBe(50_000_000);
  });
});

describe('paraphrase threshold export (E5)', () => {
  it('is documented and conservative', () => {
    expect(PAIN_MERGE_THRESHOLD).toBe(0.85);
  });
});
