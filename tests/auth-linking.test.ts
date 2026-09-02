import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { users } from '@/lib/db/schema';

let db: Db;

beforeEach(() => {
  db = useTestDb();
});

async function loadEnsureDomainUser() {
  const mod = await import('@/lib/auth/better-auth');
  return mod.ensureDomainUser;
}

function seedPreexistingUser(email: string) {
  return db
    .insert(users)
    .values({ name: 'seeded-operator', passwordHash: 'x', email, role: 'admin' })
    .returning()
    .get();
}

describe('ensureDomainUser email linking', () => {
  it('does NOT link an unverified signup to an existing user row with the same email', async () => {
    const pre = seedPreexistingUser('operator@example.com');
    const ensureDomainUser = await loadEnsureDomainUser();

    const result = ensureDomainUser('auth-attacker', 'attacker', 'operator@example.com', false);

    const untouched = db.select().from(users).where(eq(users.id, pre.id)).get();
    expect(untouched?.authUserId).toBeNull();
    expect(untouched?.role).toBe('admin');
    // a fresh domain user was created instead, without claiming the email
    expect(result.id).not.toBe(pre.id);
    expect(result.authUserId).toBe('auth-attacker');
    expect(result.role).toBe('member');
    expect(result.email).toBeNull();
  });

  it('links a provider-verified signup to the existing row with the same email', async () => {
    const pre = seedPreexistingUser('operator@example.com');
    const ensureDomainUser = await loadEnsureDomainUser();

    const result = ensureDomainUser('auth-social', 'operator', 'operator@example.com', true);

    expect(result.id).toBe(pre.id);
    const linked = db.select().from(users).where(eq(users.id, pre.id)).get();
    expect(linked?.authUserId).toBe('auth-social');
    expect(linked?.emailVerified).toBe(true);
    // no duplicate row created
    expect(db.select().from(users).where(eq(users.email, 'operator@example.com')).all()).toHaveLength(1);
  });

  it('defaults to no linking when the verified flag is omitted', async () => {
    const pre = seedPreexistingUser('operator@example.com');
    const ensureDomainUser = await loadEnsureDomainUser();

    const result = ensureDomainUser('auth-new', 'newbie', 'operator@example.com');

    expect(result.id).not.toBe(pre.id);
    expect(db.select().from(users).where(eq(users.id, pre.id)).get()?.authUserId).toBeNull();
  });

  it('keeps the email on a fresh signup with no pre-existing row', async () => {
    const ensureDomainUser = await loadEnsureDomainUser();

    const result = ensureDomainUser('auth-fresh', 'fresh', 'fresh@example.com', false);

    expect(result.email).toBe('fresh@example.com');
    expect(db.select().from(users).where(eq(users.authUserId, 'auth-fresh')).all()).toHaveLength(1);
  });

  it('returns the same row when the auth user already has a domain user', async () => {
    const ensureDomainUser = await loadEnsureDomainUser();
    const first = ensureDomainUser('auth-repeat', 'rep', 'rep@example.com', false);

    const second = ensureDomainUser('auth-repeat', 'rep', 'rep@example.com', false);

    expect(second.id).toBe(first.id);
    expect(db.select().from(users).where(eq(users.authUserId, 'auth-repeat')).all()).toHaveLength(1);
  });
});
