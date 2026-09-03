import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { users } from '@/lib/db/schema';
import { POST } from '@/app/api/auth/login/route';
import {
  _loginAttemptsSize,
  _resetLoginAttempts,
  recordFailure,
  sweepExpiredFailures,
} from '@/lib/auth/login-attempts';
import { useTestDb } from './helpers/db';

let db: ReturnType<typeof useTestDb>;

beforeEach(() => {
  db = useTestDb();
  _resetLoginAttempts();
});

function post(name: string, password: string, ip = '203.0.113.7') {
  return POST(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ name, password }),
    }),
  );
}

function seedLoginUser(name: string, passwordHash: string): void {
  db.insert(users).values({ name, passwordHash }).run();
}

describe('login timing-oracle hardening', () => {
  it('compares against the same dummy hash for unknown and passwordless users', async () => {
    seedLoginUser('nopass', '');
    const spy = vi.spyOn(bcrypt, 'compare');
    try {
      expect((await post('ghost', 'pw')).status).toBe(401);
      expect((await post('nopass', 'pw')).status).toBe(401);

      expect(spy).toHaveBeenCalledTimes(2);
      const unknownHash = spy.mock.calls[0][1];
      const passwordlessHash = spy.mock.calls[1][1];
      // both paid the full bcrypt cost against the dummy hash — a fast-fail on
      // the empty stored hash would reveal which legacy names have passwords
      expect(passwordlessHash).toBe(unknownHash);
      expect(passwordlessHash).toMatch(/^\$2[aby]\$/);
    } finally {
      spy.mockRestore();
    }
  });

  it('never logs a passwordless user in, even if the dummy plaintext is guessed', async () => {
    seedLoginUser('nopass', '');
    // DUMMY_HASH is bcrypt('invalid-password-placeholder') — guessing it must still 401
    expect((await post('nopass', 'invalid-password-placeholder')).status).toBe(401);
  });

  it('accepts the right password for a user with a real hash', async () => {
    seedLoginUser('operator', bcrypt.hashSync('hunter2', 10));
    const res = await post('operator', 'hunter2');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('radar_session=v2.');
    expect((await post('operator', 'wrong-password')).status).toBe(401);
  });
});

describe('login failure-map GC', () => {
  it('sweepExpiredFailures drops expired entries so the map cannot retain them', () => {
    recordFailure('203.0.113.7|ghost');
    expect(_loginAttemptsSize()).toBe(1);
    // still inside the 15-minute window: an immediate sweep keeps the entry
    sweepExpiredFailures();
    expect(_loginAttemptsSize()).toBe(1);
    // past the window: the periodic sweep trigger removes it
    sweepExpiredFailures(Date.now() + 16 * 60e3);
    expect(_loginAttemptsSize()).toBe(0);
  });

  it('stops locking once the expired entry is swept', async () => {
    const key = '203.0.113.7|ghost';
    for (let i = 0; i < 10; i++) recordFailure(key);
    expect((await post('ghost', 'pw')).status).toBe(429);

    sweepExpiredFailures(Date.now() + 16 * 60e3);
    expect(_loginAttemptsSize()).toBe(0);
    expect((await post('ghost', 'pw')).status).toBe(401); // back to plain invalid-credentials
  });
});
