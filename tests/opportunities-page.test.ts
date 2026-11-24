import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { eq } from 'drizzle-orm';
import { opportunities } from '@/lib/db/schema';
import OpportunitiesPage from '@/app/app/build/opportunities/page';
import OpportunityList, { type OppView } from '@/components/OpportunityList';
import { seedUser, useTestDb } from './helpers/db';
import { commercialFixture } from './fixtures/opportunity-commercial';
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

function listProps(tree: unknown): { opps: OppView[] } {
  const list = [...elements(tree)].find((el) => el.type === OpportunityList);
  expect(list).toBeDefined();
  return list!.props as { opps: OppView[] };
}

describe('opportunities index payload bounding', () => {
  it('caps the default view at 50 dossiers with a show-all affordance', async () => {
    for (let i = 1; i <= 60; i++) seedOpp(i);

    const tree = await OpportunitiesPage({ searchParams: Promise.resolve({}) });
    const { opps } = listProps(tree);
    expect(opps).toHaveLength(50);
    // With all other inputs equal, improving flip increases the baseline.
    expect(opps.map((o) => o.id)).toContain(60);
    expect(opps.map((o) => o.id)).not.toContain(1);
    expect(textOf(tree)).toContain('showing the top 50 of 60');
  });

  it('ranks every visible active opening before limiting and defaults to that order on the client', async () => {
    for (let i = 1; i <= 60; i++) seedOpp(i);
    const kpis = JSON.stringify({ commercial: commercialFixture, priceUsd: 20, monthlyCostUsd: 100, breakEvenCustomers: 50 });
    db.update(opportunities).set({ kpis }).where(eq(opportunities.id, 1)).run();
    db.update(opportunities).set({ kpis, ownerUserId: seedUser(db) }).where(eq(opportunities.id, 59)).run();
    db.update(opportunities).set({ kpis, verdict: 'reject' }).where(eq(opportunities.id, 60)).run();
    const firstPage = listProps(await OpportunitiesPage({ searchParams: Promise.resolve({}) })).opps;
    const full = listProps(await OpportunitiesPage({ searchParams: Promise.resolve({ all: '1' }) })).opps;
    expect(firstPage.map(o => o.id)).toEqual(full.slice(0, 50).map(o => o.id));
    expect(firstPage[0].id).toBe(1); // lowest flip, strongest commercial case
    expect(full.some(o => o.id === 59)).toBe(false);
    expect(full.at(-1)?.id).toBe(60);
    const html = renderToStaticMarkup(React.createElement(OpportunityList, {
      opps: [firstPage[1], firstPage[0]], canGenerate: false,
    }));
    expect(html.indexOf('id="opp-1"')).toBeLessThan(html.indexOf(`id="opp-${firstPage[1].id}"`));
    expect(html).toContain('aria-label="Sort by"');
    expect(html).toContain('aria-label="Filters"');
    expect(html).toContain('Business viability');
    expect(html).toContain('Ties favor lower base acquisition cash for the first 10 payers.');
    expect(html).toContain('Unknown cash estimates come last among ties.');
    expect(html).toContain('flip — build &amp; sell');
    expect(html).toContain('hold — keep for mrr');
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
