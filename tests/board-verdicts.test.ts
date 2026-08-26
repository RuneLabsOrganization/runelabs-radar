import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { boardEntries, boardHistory } from '@/lib/db/schema';
import { SEED_VERDICTS, applySeedVerdicts } from '@/lib/board/verdicts';
import { SEED_BOARD_TASKS } from '@/lib/db/seed-data';
import { DOMAINS } from '@/lib/domains';

function seedEmptyBoard(db: Db): void {
  for (const domain of DOMAINS) {
    for (const task of SEED_BOARD_TASKS[domain]) {
      db.insert(boardEntries).values({ domain, task }).run();
    }
  }
}

describe('board seed verdicts', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    seedEmptyBoard(db);
  });

  it('covers every seeded board cell', () => {
    const cells = new Set(SEED_VERDICTS.map((v) => `${v.domain}/${v.task}`));
    for (const domain of DOMAINS) {
      for (const task of SEED_BOARD_TASKS[domain]) {
        expect(cells.has(`${domain}/${task}`), `${domain}/${task}`).toBe(true);
      }
    }
  });

  it('every verdict has prose, even where the picks are blank', () => {
    for (const v of SEED_VERDICTS) {
      expect(v.verdict.length, `${v.domain}/${v.task}`).toBeGreaterThan(80);
    }
  });

  it('fills empty cells and records history', () => {
    const touched = applySeedVerdicts();
    expect(touched).toBe(SEED_VERDICTS.length);

    const row = db
      .select()
      .from(boardEntries)
      .where(eq(boardEntries.domain, 'video'))
      .all()
      .find((r) => r.task === 'text-to-video')!;
    expect(row.bestOverall).toBe('Seedance 2.0');
    expect(row.bestValue).toBe('Kling 3.0');
    expect(row.verdictAuthor).toBe('Runelabs');
    expect(db.select().from(boardHistory).all()).toHaveLength(SEED_VERDICTS.length);
  });

  // The product claim is that we leave gaps visible rather than guessing.
  it('leaves an undefendable cell blank but explains itself', () => {
    applySeedVerdicts();
    const row = db
      .select()
      .from(boardEntries)
      .where(eq(boardEntries.domain, 'agentic'))
      .all()
      .find((r) => r.task === 'orchestration')!;
    expect(row.bestOverall).toBeNull();
    expect(row.bestValue).toBeNull();
    expect(row.cheapestViable).toBeNull();
    expect(row.runelabsVerdict).toContain('Not yet covered');
  });

  it('never overwrites a verdict a human already wrote', () => {
    const target = db
      .select()
      .from(boardEntries)
      .where(eq(boardEntries.domain, 'coding'))
      .all()
      .find((r) => r.task === 'autocomplete')!;
    db.update(boardEntries)
      .set({ bestOverall: 'Human pick', runelabsVerdict: 'Human verdict', verdictAuthor: 'specter' })
      .where(eq(boardEntries.id, target.id))
      .run();

    applySeedVerdicts();

    const after = db.select().from(boardEntries).where(eq(boardEntries.id, target.id)).get()!;
    expect(after.bestOverall).toBe('Human pick');
    expect(after.runelabsVerdict).toBe('Human verdict');
    expect(after.verdictAuthor).toBe('specter');
    // the columns the human left alone still get filled
    expect(after.bestValue).toBe('GitHub Copilot');
  });

  it('is idempotent', () => {
    applySeedVerdicts();
    const second = applySeedVerdicts();
    expect(second).toBe(0);
    expect(db.select().from(boardHistory).all()).toHaveLength(SEED_VERDICTS.length);
  });
});
