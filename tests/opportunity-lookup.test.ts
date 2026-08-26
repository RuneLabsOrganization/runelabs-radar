import { beforeEach, describe, expect, it } from 'vitest';
import { opportunities } from '@/lib/db/schema';
import { lookupVisibleOpportunity } from '@/lib/opportunities/lookup';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function seedOpp(db: Db, opts: { slug: string; title: string; ownerUserId: number | null; flip?: number }) {
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
      flipScore: opts.flip ?? 80,
      holdScore: 50,
      scores: '{}',
      evidence: '[]',
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .returning()
    .get()!;
}

describe('lookupVisibleOpportunity', () => {
  let db: Db;
  let publicRow: { id: number; slug: string };
  let privateRow: { id: number; slug: string };

  beforeEach(() => {
    db = useTestDb();
    seedUser(db, 1);
    seedUser(db, 2);
    publicRow = seedOpp(db, { slug: 'local-llm-quantization-benchmark-tool', title: 'Public benchmarker', ownerUserId: null });
    privateRow = seedOpp(db, { slug: 'alice-private-opening', title: 'Alice private', ownerUserId: 1 });
  });

  it('resolves a public opening by slug for an anonymous viewer', () => {
    const row = lookupVisibleOpportunity(publicRow.slug, null);
    expect(row?.id).toBe(publicRow.id);
    expect(row?.title).toBe('Public benchmarker');
  });

  it('resolves a public opening by numeric id', () => {
    const row = lookupVisibleOpportunity(String(publicRow.id), null);
    expect(row?.id).toBe(publicRow.id);
  });

  it('returns undefined for an unknown slug', () => {
    expect(lookupVisibleOpportunity('no-such-opening', null)).toBeUndefined();
  });

  it('hides a private opening from anonymous and from another owner', () => {
    expect(lookupVisibleOpportunity(privateRow.slug, null)).toBeUndefined();
    expect(lookupVisibleOpportunity(privateRow.slug, 2)).toBeUndefined();
    expect(lookupVisibleOpportunity(String(privateRow.id), null)).toBeUndefined();
  });

  it('returns the owner their private opening by slug', () => {
    expect(lookupVisibleOpportunity(privateRow.slug, 1)?.title).toBe('Alice private');
  });

  it('prefers the caller\'s private row when a public opening shares the slug', () => {
    seedOpp(db, {
      slug: publicRow.slug,
      title: 'Alice fork of the public opening',
      ownerUserId: 1,
      flip: 10,
    });
    expect(lookupVisibleOpportunity(publicRow.slug, 1)?.title).toBe('Alice fork of the public opening');
    expect(lookupVisibleOpportunity(publicRow.slug, null)?.title).toBe('Public benchmarker');
    expect(lookupVisibleOpportunity(publicRow.slug, 2)?.title).toBe('Public benchmarker');
  });
});
