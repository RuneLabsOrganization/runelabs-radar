import { beforeEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import LandingPage from '@/app/(site)/page';
import { items, sources, stories } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

type El = React.ReactElement<{ children?: unknown }>;

function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf((node as El).props?.children);
}

let db: Db;

beforeEach(() => {
  db = useTestDb();
});

function seedSource(name: string): number {
  return db
    .insert(sources)
    .values({ type: 'rss', name, enabled: true })
    .returning({ id: sources.id })
    .get()!.id;
}

function seedItem(sourceId: number, url: string, daysAgo = 0) {
  db.insert(items)
    .values({ sourceId, url, title: url, fetchedAt: new Date(Date.now() - daysAgo * 864e5) })
    .run();
}

function seedStory(title: string, daysAgo: number, hindsight: number | null = null) {
  db.insert(stories)
    .values({
      title,
      status: 'curated',
      topScore: 70,
      hindsight,
      hindsightAt: hindsight === null ? null : new Date(),
      createdAt: new Date(Date.now() - daysAgo * 864e5),
    })
    .run();
}

describe('landing hero facts — the numbers count what the labels claim', () => {
  it('headline counts curated STORIES, not raw feed items', () => {
    const a = seedSource('feed-a');
    const b = seedSource('feed-b');
    // 10 raw items in the window but only 2 curated stories — the old query
    // quoted the 10 as "stories", a ~5x unit inflation
    for (let i = 0; i < 6; i++) seedItem(a, `https://a.test/${i}`);
    for (let i = 0; i < 4; i++) seedItem(b, `https://b.test/${i}`);
    seedStory('story one', 1);
    seedStory('story two', 5);
    seedStory('old story', 40); // outside the 30d window

    const text = textOf(LandingPage());
    expect(text).toContain('We read 2 AI stories last month.');
    expect(text).not.toContain('We read 10 AI stories');
  });

  it('sources count = sources that yielded items, not enabled feeds', () => {
    const a = seedSource('feed-a');
    seedSource('feed-b'); // enabled but dead: zero items
    seedSource('feed-c'); // enabled but dead
    seedItem(a, 'https://a.test/1');

    const text = textOf(LandingPage());
    expect(text).toContain('1 active sources');
    expect(text).toContain('sources read · 30d');
    expect(text).not.toContain('3 active sources');
    expect(text).not.toContain('sources read daily');
  });

  it('predictions graded is labeled all-time (sibling stats are 30d windows)', () => {
    seedStory('graded story', 60, 55); // graded long ago — still counts, honestly labeled
    const text = textOf(LandingPage());
    expect(text).toContain('predictions graded · all time');
    expect(text).not.toContain('predictions graded·');
  });
});
