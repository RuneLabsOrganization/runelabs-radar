import { openDb, _setDb, type Db } from '@/lib/db';
import { users } from '@/lib/db/schema';

/**
 * Creates a fresh in-memory database (migrated) and installs it as the
 * process singleton so lib code under test uses it. Call in beforeEach.
 */
export function useTestDb(): Db {
  const db = openDb(':memory:');
  _setDb(db);
  return db;
}

/**
 * Insert a user row and return its id.
 *
 * Required by any test that drives an MCP tool with a non-null
 * AuthContext.userId: openDb sets `PRAGMA foreign_keys = ON`, and several
 * tables the tools write to reference users.id — mcp_economy (written by
 * respond() on every structured payload), plan_entitlements, user_profiles
 * and agent_sessions. Without a matching row those inserts fail.
 *
 * Pass an explicit id when the test hardcodes one (e.g. `userId: 1` in an
 * AuthContext); otherwise let SQLite assign it.
 */
export function seedUser(db: Db, id?: number): number {
  const values = {
    name: `test-user-${id ?? Math.random().toString(36).slice(2, 9)}`,
    passwordHash: 'x',
  };
  const row = db
    .insert(users)
    .values(id === undefined ? values : { id, ...values })
    .returning({ id: users.id })
    .get();
  return row!.id;
}
