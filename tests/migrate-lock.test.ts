import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withMigrateLock } from '@/lib/db';

const DB_PATH = path.join(os.tmpdir(), 'migrate-lock-test', 'radar.db');

/** Windows hands back EPERM/EACCES — not EEXIST — when a peer holds or is unlinking the lock. */
function errno(code: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: operation not permitted, open '${DB_PATH}.migrate.lock'`) as NodeJS.ErrnoException;
  err.code = code;
  err.syscall = 'open';
  return err;
}

/** Mock the lock file syscalls so no real fd is ever opened. */
function stubLockFs(openSync: (calls: number) => number): { calls: () => number } {
  let calls = 0;
  vi.spyOn(fs, 'openSync').mockImplementation((() => openSync(++calls)) as typeof fs.openSync);
  vi.spyOn(fs, 'closeSync').mockImplementation(() => undefined);
  vi.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined);
  return { calls: () => calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withMigrateLock', () => {
  it('retries after a transient EPERM and runs the callback exactly once', () => {
    const lock = stubLockFs((n) => {
      if (n === 1) throw errno('EPERM');
      return 42;
    });
    const fn = vi.fn();

    withMigrateLock(DB_PATH, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(lock.calls()).toBe(2);
  });

  it('retries after a transient EACCES and runs the callback exactly once', () => {
    const lock = stubLockFs((n) => {
      if (n === 1) throw errno('EACCES');
      return 42;
    });
    const fn = vi.fn();

    withMigrateLock(DB_PATH, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(lock.calls()).toBe(2);
  });

  it('still retries on EEXIST', () => {
    const lock = stubLockFs((n) => {
      if (n === 1) throw errno('EEXIST');
      return 42;
    });
    const fn = vi.fn();

    withMigrateLock(DB_PATH, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(lock.calls()).toBe(2);
  });

  it('rethrows errors that are not lock contention', () => {
    const lock = stubLockFs(() => {
      throw errno('ENOSPC');
    });
    const fn = vi.fn();

    expect(() => withMigrateLock(DB_PATH, fn)).toThrow(/ENOSPC/);
    expect(fn).not.toHaveBeenCalled();
    expect(lock.calls()).toBe(1);
  });

  it('runs the callback without touching the filesystem for :memory:', () => {
    const lock = stubLockFs(() => {
      throw new Error('openSync should not be called for :memory:');
    });
    const fn = vi.fn();

    withMigrateLock(':memory:', fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(lock.calls()).toBe(0);
  });
});
