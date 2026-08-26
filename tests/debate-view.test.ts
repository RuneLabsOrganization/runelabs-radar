import { beforeEach, describe, expect, it } from 'vitest';
import { debates, opportunities } from '@/lib/db/schema';
import {
  listVisibleDebateCards,
  loadVisibleDebate,
  parseStoredDebate,
} from '@/lib/opportunities/debate-view';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function seedOpp(db: Db, opts: { slug: string; title: string; ownerUserId: number | null }) {
  const now = new Date();
  return db
    .insert(opportunities)
    .values({
      slug: opts.slug,
      ownerUserId: opts.ownerUserId,
      title: opts.title,
      thesis: `${opts.title} is a sufficiently long thesis for downstream validation.`,
      sector: 'coding',
      status: 'active',
      flipScore: 70,
      holdScore: 50,
      scores: '{}',
      evidence: '[]',
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .returning()
    .get()!;
}

function seedDebate(
  db: Db,
  opts: {
    opportunityId: number | null;
    ideaText?: string | null;
    transcript: string;
    verdict?: 'pursue' | 'watch' | 'reject';
  },
) {
  return db
    .insert(debates)
    .values({
      opportunityId: opts.opportunityId,
      ideaText: opts.ideaText ?? null,
      transcript: opts.transcript,
      verdict: opts.verdict ?? 'watch',
      confidence: 62,
      createdAt: new Date(),
    })
    .returning()
    .get()!;
}

const TRANSCRIPT = JSON.stringify([
  { role: 'advocate', text: 'Demand is real.' },
  { role: 'skeptic', text: 'Window is short.' },
  { role: 'realist', text: 'Economics close.' },
  {
    role: 'judge',
    text: 'Watch it.',
    killRisks: ['incumbent ships it'],
    conditionsToSucceed: ['own a channel'],
    strengthenedVariants: ['narrow the ICP'],
  },
]);

describe('parseStoredDebate', () => {
  it('reads turns and the judge extras', () => {
    const view = parseStoredDebate({
      verdict: 'watch',
      confidence: 62,
      transcript: TRANSCRIPT,
    });
    expect(view.turns.map((t) => t.role)).toEqual(['advocate', 'skeptic', 'realist', 'judge']);
    expect(view.killRisks).toEqual(['incumbent ships it']);
    expect(view.conditionsToSucceed).toEqual(['own a channel']);
    expect(view.strengthenedVariants).toEqual(['narrow the ICP']);
  });

  it('survives corrupt JSON', () => {
    const view = parseStoredDebate({ verdict: 'reject', confidence: 10, transcript: 'not-json' });
    expect(view.turns).toEqual([]);
    expect(view.verdict).toBe('reject');
  });
});

describe('debate visibility', () => {
  let db: Db;
  let publicDebateId: number;
  let privateDebateId: number;
  let freeTextId: number;

  beforeEach(() => {
    db = useTestDb();
    seedUser(db, 1);
    const pub = seedOpp(db, { slug: 'public-opening', title: 'Public opening', ownerUserId: null });
    const priv = seedOpp(db, { slug: 'alice-private', title: 'SECRET PRIVATE TITLE', ownerUserId: 1 });
    publicDebateId = seedDebate(db, { opportunityId: pub.id, transcript: TRANSCRIPT }).id;
    privateDebateId = seedDebate(db, {
      opportunityId: priv.id,
      ideaText: 'SECRET PRIVATE IDEA',
      transcript: TRANSCRIPT,
    }).id;
    freeTextId = seedDebate(db, {
      opportunityId: null,
      ideaText: 'A free-text idea about local VLMs',
      transcript: TRANSCRIPT,
    }).id;
  });

  it('loads a public opportunity debate for anyone', () => {
    const loaded = loadVisibleDebate(publicDebateId, null);
    expect(loaded?.title).toBe('Public opening');
    expect(loaded?.opportunitySlug).toBe('public-opening');
    expect(loaded?.view.turns).toHaveLength(4);
  });

  it('hides a private opportunity debate from anonymous viewers', () => {
    expect(loadVisibleDebate(privateDebateId, null)).toBeNull();
    expect(loadVisibleDebate(privateDebateId, 2)).toBeNull();
  });

  it('lets the owner read their private opportunity debate', () => {
    expect(loadVisibleDebate(privateDebateId, 1)?.title).toBe('SECRET PRIVATE TITLE');
  });

  it('still shows free-text debates', () => {
    expect(loadVisibleDebate(freeTextId, null)?.title).toContain('free-text idea');
  });

  it('omits private-opportunity cards from the anonymous list', () => {
    const cards = listVisibleDebateCards(null);
    const titles = cards.map((c) => c.title);
    expect(titles).toContain('Public opening');
    expect(titles.some((t) => t.includes('free-text'))).toBe(true);
    expect(titles.join(' ')).not.toContain('SECRET');
  });
});
