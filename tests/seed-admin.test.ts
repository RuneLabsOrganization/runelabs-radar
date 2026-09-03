import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { openDb, rawSqlite, type Db } from '@/lib/db';
import { users } from '@/lib/db/schema';

// The seed script's real entry path: env var (preferred) vs argv (warns).
// Subprocesses against a temp DATABASE_PATH so the CLI behavior — arg
// parsing, .env interplay, exit codes — is what actually runs.

let tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

function runSeed(args: string[], env: Record<string, string | undefined>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-seed-'));
  tmpDirs.push(dir);
  const dbPath = path.join(dir, 'seed.db');
  const res = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/seed.ts', ...args], {
    env: { ...process.env, ...env, DATABASE_PATH: dbPath },
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { res, dbPath };
}

function readAdmin(dbPath: string, name: string) {
  const db: Db = openDb(dbPath);
  try {
    return db.select().from(users).where(eq(users.name, name)).get();
  } finally {
    rawSqlite(db).close();
  }
}

describe('scripts/seed.ts --admin', () => {
  it('creates the admin from SEED_ADMIN_PASSWORD with no password on argv', { timeout: 180_000 }, () => {
    const { res, dbPath } = runSeed(['--admin', 'env-admin'], { SEED_ADMIN_PASSWORD: 's3cret-pw' });
    expect(res.status).toBe(0);
    expect(res.stderr).not.toContain('shell history');

    const admin = readAdmin(dbPath, 'env-admin');
    expect(admin?.role).toBe('admin');
    expect(bcrypt.compareSync('s3cret-pw', admin!.passwordHash)).toBe(true);
  });

  it('keeps the argv form working but warns about shell history', { timeout: 180_000 }, () => {
    const { res, dbPath } = runSeed(['--admin', 'argv-admin', 'argv-pw'], {});
    expect(res.status).toBe(0);
    expect(res.stderr).toContain('SEED_ADMIN_PASSWORD');

    const admin = readAdmin(dbPath, 'argv-admin');
    expect(bcrypt.compareSync('argv-pw', admin!.passwordHash)).toBe(true);
  });

  it('fails with usage when neither argv nor the env var provides a password', { timeout: 180_000 }, () => {
    const env = { ...process.env };
    delete env.SEED_ADMIN_PASSWORD;
    const { res } = runSeed(['--admin', 'no-pw'], env);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('SEED_ADMIN_PASSWORD');
  });
});
