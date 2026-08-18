import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/lib/db';
import { patterns, stories } from '@/lib/db/schema';
import { chatJSON } from '@/lib/llm/minimax';
import { runGateAudit } from '@/lib/curate/gate-audit';
import { useTestDb } from './helpers/db';

vi.mock('@/lib/llm/minimax', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/minimax')>();
  return { ...actual, chatJSON: vi.fn() };
});

const mockChat = chatJSON as unknown as Mock;

describe('runGateAudit', () => {
  let db: Db;

  beforeEach(() => {
    db = useTestDb();
    mockChat.mockReset();
  });

  it('returns zeros and writes nothing when no filtered stories exist', async () => {
    const res = await runGateAudit();
    expect(res.sampled).toBe(0);
    expect(res.falseKills).toBe(0);
    expect(mockChat).not.toHaveBeenCalled();
    expect(db.select().from(patterns).all()).toHaveLength(0);
  });

  it('re-scores a filtered sample and reports false kills in a patterns row', async () => {
    db.insert(stories)
      .values([
        { title: 'Kim Kardashian launches perfume line', status: 'filtered', createdAt: new Date() },
        { title: 'OpenAI launches GPT-5.2 with agentic tools', status: 'filtered', createdAt: new Date() },
      ])
      .run();

    // the sample order is RANDOM() — match on prompt content, not call order
    mockChat.mockImplementation(async (_system: string, user: string) =>
      user.includes('GPT-5.2')
        ? { domain_scores: { coding: 85 }, tldr: 't', why_it_matters: 'w' }
        : { domain_scores: { coding: 5 }, tldr: 't', why_it_matters: 'w' },
    );

    const res = await runGateAudit();
    expect(res.sampled).toBe(2);
    expect(res.falseKills).toBe(1);
    expect(res.falseKillRate).toBe(50);

    const row = db.select().from(patterns).where(eq(patterns.kind, 'gate-audit')).get()!;
    expect(row.headline).toContain('1/2');
    expect(row.detail).toContain('OpenAI launches GPT-5.2');
  });
});
