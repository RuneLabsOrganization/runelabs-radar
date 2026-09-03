import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { _setDb, openDb, rawSqlite, type Db } from '@/lib/db';
import { mcpEconomy, users } from '@/lib/db/schema';
import { economyThisCycle, recordEconomy } from '@/lib/mcp-economy';

// B3: recordEconomy is one atomic upsert (usage_counters pattern) — two
// writers on the same (user, cycle) must both land. Two connections to one
// file db stand in for two MCP processes; better-sqlite3 serializes their
// statements exactly as the OS scheduler would, and the old select-then-
// insert loser's unique-index throw is gone by construction.
describe('recordEconomy atomic upsert', () => {
  let dir: string;
  let dbA: Db;
  let dbB: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'radar-economy-'));
    dbA = openDb(join(dir, 'test.db'));
    dbB = openDb(join(dir, 'test.db'));
  });

  afterEach(() => {
    _setDb(null);
    rawSqlite(dbA).close();
    rawSqlite(dbB).close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('two writers on the same (user, cycle) sum correctly', () => {
    const uid = dbA.insert(users).values({ name: 'eco-race', passwordHash: 'x' }).returning({ id: users.id }).get()!
      .id;

    _setDb(dbA);
    recordEconomy(uid, { returned: 100, saved_vs_full: 400, saved_vs_diy: 1000 });
    _setDb(dbB);
    recordEconomy(uid, { returned: 50, saved_vs_full: 200, saved_vs_diy: 500 });

    const cycleKey = economyThisCycle(uid).cycle_key; // read through dbB
    const row = dbA
      .select()
      .from(mcpEconomy)
      .where(and(eq(mcpEconomy.userId, uid), eq(mcpEconomy.cycleKey, cycleKey)))
      .get();
    expect(row).toMatchObject({
      calls: 2,
      tokensReturned: 150,
      tokensSavedVsFull: 600,
      tokensSavedVsDiy: 1500,
    });
    expect(economyThisCycle(uid)).toMatchObject({
      calls: 2,
      tokens_returned: 150,
      tokens_saved_vs_full: 600,
      tokens_saved_vs_diy: 1500,
    });
  });

  it('a pre-existing row from another writer is incremented, never thrown on', () => {
    const uid = dbA.insert(users).values({ name: 'eco-pre', passwordHash: 'x' }).returning({ id: users.id }).get()!
      .id;
    // writer A's row lands first, unseen by writer B's process cache
    _setDb(dbA);
    recordEconomy(uid, { returned: 10, saved_vs_full: 20, saved_vs_diy: 30 });
    _setDb(dbB);
    expect(() => recordEconomy(uid, { returned: 1, saved_vs_full: 2, saved_vs_diy: 3 })).not.toThrow();
    expect(economyThisCycle(uid)).toMatchObject({ calls: 2, tokens_saved_vs_diy: 33 });
  });
});
