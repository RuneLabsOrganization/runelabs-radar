import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import { stacks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

vi.mock('@/lib/llm/minimax', () => ({
  chatJSON: vi.fn(),
  LlmError: class LlmError extends Error {},
}));

import { chatJSON } from '@/lib/llm/minimax';
import { runStacks, sanitizeStack, VENTURES } from '@/lib/stacks/generate';

const VALID_DRAFT = {
  title: 'Next + Supabase speedrun',
  tagline: 'boring and fast',
  layers: [
    { layer: 'hosting', pick: 'Hetzner + Docker', alt: 'Vercel', note: 'own the box' },
    { layer: 'frontend', pick: 'Next.js', alt: 'SvelteKit', note: 'AI knows it best' },
    { layer: 'backend', pick: 'Next API routes', alt: 'FastAPI', note: 'one repo' },
    { layer: 'database', pick: 'Postgres (Supabase)', alt: 'SQLite', note: 'managed' },
    { layer: 'auth', pick: 'Supabase Auth', alt: 'Clerk', note: 'free tier' },
    { layer: 'payments', pick: 'Stripe', alt: 'Paddle', note: 'standard' },
  ],
  costNote: '~$20/mo at MVP scale',
  timeToMvp: '3-5 days',
  rationale: 'Boring picks ship fastest.',
};

describe('sanitizeStack', () => {
  it('accepts a valid draft and sorts layers into canonical order', () => {
    const draft = sanitizeStack(VALID_DRAFT);
    expect(draft).not.toBeNull();
    expect(draft!.title).toBe('Next + Supabase speedrun');
    expect(draft!.layers[0].layer).toBe('frontend'); // hosting was listed first, sorted away
    expect(draft!.layers.map((l) => l.layer)).toContain('hosting');
  });

  it('rejects drafts without a title or with fewer than 5 known layers', () => {
    expect(sanitizeStack({ ...VALID_DRAFT, title: '' })).toBeNull();
    expect(sanitizeStack({ ...VALID_DRAFT, layers: VALID_DRAFT.layers.slice(0, 3) })).toBeNull();
    expect(sanitizeStack('nope')).toBeNull();
  });

  it('drops unknown and duplicate layers', () => {
    const draft = sanitizeStack({
      ...VALID_DRAFT,
      layers: [
        ...VALID_DRAFT.layers,
        { layer: 'blockchain', pick: 'no' },
        { layer: 'frontend', pick: 'duplicate' },
      ],
    });
    expect(draft!.layers.filter((l) => l.layer === 'frontend')).toHaveLength(1);
    expect(draft!.layers.some((l) => l.layer === 'blockchain')).toBe(false);
  });
});

describe('runStacks', () => {
  beforeEach(() => {
    vi.mocked(chatJSON).mockReset();
  });

  it('upserts every venture and preserves existing team verdicts', async () => {
    const db = useTestDb();
    db.insert(stacks)
      .values({
        venture: VENTURES[0].slug,
        title: 'Old stack',
        layers: '[]',
        runelabsVerdict: 'we ship this',
        verdictAuthor: 'specter',
        updatedAt: new Date(0),
      })
      .run();
    vi.mocked(chatJSON).mockResolvedValue(VALID_DRAFT as never);

    const res = await runStacks();
    expect(res).toEqual({ updated: VENTURES.length, failed: 0 });

    const first = db.select().from(stacks).where(eq(stacks.venture, VENTURES[0].slug)).get()!;
    expect(first.title).toBe('Next + Supabase speedrun'); // refreshed
    expect(first.runelabsVerdict).toBe('we ship this'); // preserved
    expect(db.select().from(stacks).all()).toHaveLength(VENTURES.length);
  });

  it('counts unparseable drafts as failed without writing', async () => {
    const db = useTestDb();
    vi.mocked(chatJSON).mockResolvedValue({ garbage: true } as never);
    const res = await runStacks();
    expect(res).toEqual({ updated: 0, failed: VENTURES.length });
    expect(db.select().from(stacks).all()).toHaveLength(0);
  });
});
