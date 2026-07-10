import { openDb, _setDb, type Db } from '@/lib/db';

/**
 * Creates a fresh in-memory database (migrated) and installs it as the
 * process singleton so lib code under test uses it. Call in beforeEach.
 */
export function useTestDb(): Db {
  const db = openDb(':memory:');
  _setDb(db);
  return db;
}
