import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { openDb, rawSqlite, withMigrateLock } from '@/lib/db';

// Real filesystem, real lock files — the stubbed syscall behavior of
// withMigrateLock lives in tests/migrate-lock.test.ts; this file covers the
// crash-leftover staleness path end to end. Never points at data/.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-stale-lock-'));

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Create a lock file whose mtime says it was abandoned 200s ago. */
function writeStaleLock(dbPath: string): string {
  const lockPath = `${path.resolve(dbPath)}.migrate.lock`;
  fs.writeFileSync(lockPath, '');
  const old = new Date(Date.now() - 200_000);
  fs.utimesSync(lockPath, old, old);
  return lockPath;
}

describe('stale migrate lock', () => {
  it('reclaims a lock older than 120s and boots normally', () => {
    const dbPath = path.join(dir, 'stale.db');
    const lockPath = writeStaleLock(dbPath);
    const start = Date.now();

    const db = openDb(dbPath);
    try {
      // migrations actually ran — this is a working database, not a crash loop
      const row = rawSqlite(db)
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stories'")
        .get() as { name: string } | undefined;
      expect(row?.name).toBe('stories');
      // the reclaimed lock went through the normal acquire/release cycle
      expect(fs.existsSync(lockPath)).toBe(false);
      // reclaimed immediately — a 60s wait-out means the fix regressed
      expect(Date.now() - start).toBeLessThan(30_000);
    } finally {
      rawSqlite(db).close();
    }
  });

  it('still waits on a fresh lock and times out without unlinking it', () => {
    const dbPath = path.join(dir, 'fresh.db');
    const lockPath = `${path.resolve(dbPath)}.migrate.lock`;
    fs.writeFileSync(lockPath, '');
    const fn = vi.fn();

    const start = Date.now();
    expect(() => withMigrateLock(dbPath, fn, 400)).toThrow(/Timed out waiting for migrate lock/);
    expect(Date.now() - start).toBeGreaterThanOrEqual(350);
    expect(fn).not.toHaveBeenCalled();
    // a live lock is never unlinked out from under its holder
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it('treats a just-expired lock as stale (mtime boundary)', () => {
    const dbPath = path.join(dir, 'boundary.db');
    const lockPath = `${path.resolve(dbPath)}.migrate.lock`;
    fs.writeFileSync(lockPath, '');
    const old = new Date(Date.now() - 121_000);
    fs.utimesSync(lockPath, old, old);

    const fn = vi.fn();
    withMigrateLock(dbPath, fn, 5_000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
