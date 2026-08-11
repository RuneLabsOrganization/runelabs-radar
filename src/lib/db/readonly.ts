import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { config } from '../config';
import * as schema from './schema';

export type ReadonlyDb = BetterSQLite3Database<typeof schema>;

/**
 * Read-only connection for serving processes (MCP server). Skips migrations
 * and write pragmas — the web/worker processes own the schema. Reading a
 * WAL-mode database concurrently is safe; busy_timeout covers checkpoints.
 */
export function openReadonlyDb(location?: string): ReadonlyDb {
  const sqlite = new Database(location ?? config.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  sqlite.pragma('busy_timeout = 5000');
  return drizzle(sqlite, { schema });
}
