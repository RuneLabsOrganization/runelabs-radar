import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { batches, batchItems } from '@/lib/db/schema';
import BatchesPage from '@/app/app/build/batches/page';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

let currentUser: { id: number; name: string; role: 'admin' | 'member' } | null = null;
vi.mock('@/lib/auth/user', () => ({
  requireApiUser: vi.fn(async () => currentUser),
  getCurrentUser: vi.fn(async () => currentUser),
  requireViewer: vi.fn(async () => currentUser),
}));

let db: Db;

beforeEach(() => {
  db = useTestDb();
  currentUser = null;
});

function seedBatch(slug: string, ownerId: number | null, items: number): void {
  const now = new Date();
  const b = db
    .insert(batches)
    .values({
      ownerId,
      kind: ownerId == null ? 'drop' : 'workspace',
      slug,
      title: `Batch ${slug}`,
      visibility: ownerId == null ? 'members' : 'private',
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: batches.id })
    .get()!;
  for (let i = 0; i < items; i++) {
    db.insert(batchItems)
      .values({ batchId: b.id, refType: 'idea', ideaText: `idea ${i}`, position: i, createdAt: now })
      .run();
  }
}

type El = React.ReactElement<{ children?: unknown }>;

function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf((node as El).props?.children);
}

describe('batches index item counts', () => {
  it('renders the same per-batch counts as per-row getBatchItems lookups', async () => {
    seedUser(db, 1);
    currentUser = { id: 1, name: 'alice', role: 'member' };
    seedBatch('alice-work', 1, 1);
    seedBatch('radar-drop', null, 3);
    seedBatch('alice-empty', 1, 0);

    const text = textOf(await BatchesPage());
    expect(text).toContain('Batch alice-work');
    expect(text).toContain('1 item');
    expect(text).not.toContain('1 items');
    expect(text).toContain('Batch radar-drop');
    expect(text).toContain('3 items');
    expect(text).toContain('0 items');
  });

  it('runs a constant number of queries no matter how many batches render', async () => {
    seedUser(db, 1);
    currentUser = { id: 1, name: 'alice', role: 'member' };
    seedBatch('few-1', 1, 2);
    const fewSpy = vi.spyOn(db, 'select');
    await BatchesPage();
    const fewQueries = fewSpy.mock.calls.length;
    fewSpy.mockRestore();

    for (let i = 2; i <= 8; i++) seedBatch(`many-${i}`, 1, 2);
    const manySpy = vi.spyOn(db, 'select');
    await BatchesPage();
    // the old per-row getBatchItems loop would add one select per batch
    expect(manySpy.mock.calls.length).toBe(fewQueries);
  });
});
