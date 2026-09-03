import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { opportunities } from '@/lib/db/schema';
import OpportunitiesPage from '@/app/app/build/opportunities/page';
import OpportunityList from '@/components/OpportunityList';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

// pages treat a null viewer as anonymous — enough to render the public radar
vi.mock('@/lib/auth/user', () => ({
  requireApiUser: vi.fn(async () => null),
  getCurrentUser: vi.fn(async () => null),
  requireViewer: vi.fn(async () => null),
}));

let db: Db;

beforeEach(() => {
  db = useTestDb();
});

function seedOpp(i: number, status: 'active' | 'archived' = 'active'): number {
  const now = new Date();
  return db
    .insert(opportunities)
    .values({
      slug: `opp-${status}-${i}`,
      ownerUserId: null,
      title: `Opening ${status} ${i}`,
      thesis: 'A sufficiently long thesis to satisfy downstream validation.',
      sector: 'devtools',
      status,
      flipScore: i,
      holdScore: 50,
      scores: '{}',
      evidence: '[]',
      verdict: 'pursue',
      confidence: 60,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .returning({ id: opportunities.id })
    .get()!.id;
}

type El = React.ReactElement<{ children?: unknown }>;

function* elements(node: unknown): Generator<El> {
  if (node == null || typeof node === 'boolean' || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) yield* elements(n);
    return;
  }
  const el = node as El;
  if (el.props === null || typeof el.props !== 'object') return;
  yield el;
  yield* elements(el.props.children);
}

function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf((node as El).props?.children);
}

function listProps(tree: unknown): { opps: { id: number }[] } {
  const list = [...elements(tree)].find((el) => el.type === OpportunityList);
  expect(list).toBeDefined();
  return list!.props as { opps: { id: number }[] };
}

describe('opportunities index payload bounding', () => {
  it('caps the default view at 50 dossiers with a show-all affordance', async () => {
    for (let i = 1; i <= 60; i++) seedOpp(i);

    const tree = await OpportunitiesPage({ searchParams: Promise.resolve({}) });
    const { opps } = listProps(tree);
    expect(opps).toHaveLength(50);
    // highest flip scores survive the cap (ordered desc, limited)
    expect(opps.map((o) => o.id)).toContain(60);
    expect(opps.map((o) => o.id)).not.toContain(1);
    expect(textOf(tree)).toContain('showing the top 50 of 60');
  });

  it('?all=1 ships the complete active set', async () => {
    for (let i = 1; i <= 60; i++) seedOpp(i);

    const tree = await OpportunitiesPage({ searchParams: Promise.resolve({ all: '1' }) });
    expect(listProps(tree).opps).toHaveLength(60);
    expect(textOf(tree)).not.toContain('showing the top');
  });

  it('excludes archived openings from the payload, keeping only their count', async () => {
    const activeIds = [seedOpp(1), seedOpp(2)];
    seedOpp(1, 'archived');
    seedOpp(2, 'archived');
    seedOpp(3, 'archived');

    const tree = await OpportunitiesPage({ searchParams: Promise.resolve({ all: '1' }) });
    const { opps } = listProps(tree);
    expect(opps.map((o) => o.id).sort()).toEqual(activeIds.sort());
    expect(textOf(tree)).toContain('3 archived (not re-detected for 7+ days)');
  });
});
