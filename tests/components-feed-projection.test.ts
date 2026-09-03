import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { stories } from '@/lib/db/schema';
import BriefingPage from '@/app/app/page';
import DomainPage from '@/app/app/domain/[slug]/page';
import StoryPage from '@/app/app/story/[id]/page';
import SignalEntry from '@/components/SignalEntry';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

// pages treat a null viewer as anonymous — enough to render every feed
vi.mock('@/lib/auth/user', () => ({
  requireApiUser: vi.fn(async () => null),
  getCurrentUser: vi.fn(async () => null),
  requireViewer: vi.fn(async () => null),
}));

let db: Db;

beforeEach(() => {
  db = useTestDb();
});

function seedStory(opts: {
  title: string;
  topScore: number;
  domainScores: Record<string, number>;
  status?: 'raw' | 'curated' | 'filtered';
  ageHours?: number;
}): number {
  const row = db
    .insert(stories)
    .values({
      title: opts.title,
      status: opts.status ?? 'curated',
      topScore: opts.topScore,
      tldr: `${opts.title} — summary`,
      domainScores: JSON.stringify(opts.domainScores),
      // the blob this regression suite guards: it must never reach feed pages
      embedding: Buffer.alloc(1536, 7),
      secondLook: 'contrarian note',
      createdAt: new Date(Date.now() - (opts.ageHours ?? 1) * 36e5),
    })
    .returning({ id: stories.id })
    .get();
  return row!.id;
}

type SelectSpy = { mock: { calls: unknown[][] } };

/** Every `db.select(fields)` projection that reads story columns. */
function storyProjections(spy: SelectSpy): Record<string, unknown>[] {
  return spy.mock.calls
    .map((call) => call[0])
    .filter(
      (p): p is Record<string, unknown> =>
        typeof p === 'object' && p !== null && Object.values(p).includes(stories.id),
    );
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

function expectNoBlobs(projections: Record<string, unknown>[]) {
  expect(projections.length).toBeGreaterThan(0);
  for (const p of projections) {
    expect(p).not.toHaveProperty('embedding');
    expect(p).not.toHaveProperty('secondLook');
    expect(p).not.toHaveProperty('secondLookAt');
  }
}

describe('feed page column projections (no embedding blobs on hot pages)', () => {
  it('briefing page projects the curated and raw story lists', async () => {
    const id = seedStory({ title: 'Top signal', topScore: 88, domainScores: { coding: 88 } });
    const spy = vi.spyOn(db, 'select');
    const tree = await BriefingPage();

    // both list queries (curated feed + raw archive) run as projections
    const projections = storyProjections(spy);
    expect(projections.length).toBeGreaterThanOrEqual(2);
    expectNoBlobs(projections);
    // the fields the page reads stay selected
    expect(
      projections.some(
        (p) => 'title' in p && 'tldr' in p && 'domainScores' in p && 'topScore' in p && 'updatedAt' in p,
      ),
    ).toBe(true);

    const entries = [...elements(tree)].filter((el) => el.type === SignalEntry);
    expect(entries.length).toBeGreaterThan(0);
    const first = (entries[0].props as { story: Record<string, unknown> }).story;
    expect(first).toMatchObject({ id, title: 'Top signal' });
    expect(first).not.toHaveProperty('embedding');
  });

  it('domain page projects the 72h sector scan', async () => {
    const id = seedStory({ title: 'Sector story', topScore: 85, domainScores: { coding: 90 } });
    const spy = vi.spyOn(db, 'select');
    const tree = await DomainPage({ params: Promise.resolve({ slug: 'coding' }) });

    const projections = storyProjections(spy);
    expectNoBlobs(projections);
    expect(projections.some((p) => 'domainScores' in p && 'createdAt' in p && 'title' in p)).toBe(true);

    const entries = [...elements(tree)].filter((el) => el.type === SignalEntry);
    expect(entries.length).toBeGreaterThan(0);
    const story = (entries[0].props as { story: Record<string, unknown> }).story;
    expect(story).toMatchObject({ id, title: 'Sector story' });
    expect(story).not.toHaveProperty('embedding');
  });

  it('story page projects the 200-row related rail', async () => {
    const mainId = seedStory({ title: 'Main story', topScore: 90, domainScores: { coding: 90 } });
    const relId = seedStory({ title: 'Related story', topScore: 80, domainScores: { coding: 80 } });
    seedStory({ title: 'Other sector story', topScore: 85, domainScores: { video: 85 } });
    const spy = vi.spyOn(db, 'select');
    const tree = await StoryPage({ params: Promise.resolve({ id: String(mainId) }) });

    // the related rail is projected (the single-row PK fetch may stay full)
    const projections = storyProjections(spy);
    expectNoBlobs(projections);
    expect(projections.some((p) => 'status' in p && 'domainScores' in p && 'title' in p)).toBe(true);

    // the rail renders the same-sector story, not the other-sector one
    const links = [...elements(tree)].filter(
      (el) => (el.props as { href?: unknown }).href === `/app/story/${relId}`,
    );
    expect(links.length).toBeGreaterThan(0);
    expect(textOf(tree)).toContain('Related story');
    expect(textOf(tree)).not.toContain('Other sector story');
  });
});
