import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';

let db: ReturnType<typeof useTestDb>;

beforeEach(() => {
  db = useTestDb();
});

// Dynamic import, like tests/auth-linking.test.ts: better-auth.ts calls
// getDb() at module scope, so it must load after useTestDb installs the
// in-memory db.
async function loadEnsureDomainUser() {
  const mod = await import('@/lib/auth/better-auth');
  return mod.ensureDomainUser;
}

function seedNamed(name: string): void {
  db.insert(users).values({ name, passwordHash: 'x' }).run();
}

describe('ensureDomainUser name-uniqueness cap', () => {
  it('falls back to a random suffix after 50 colliding sequential candidates', async () => {
    seedNamed('member');
    for (let n = 1; n <= 50; n++) seedNamed(`member${n}`);
    const ensureDomainUser = await loadEnsureDomainUser();

    const result = ensureDomainUser('auth-late', 'member', null, false);

    expect(result.name).toMatch(/^member-[0-9a-f]{8}$/);
    expect(db.select().from(users).where(eq(users.name, result.name)).all()).toHaveLength(1);
  });

  it('resolves 60 colliding signups with unique names and a bounded probe count', async () => {
    const ensureDomainUser = await loadEnsureDomainUser();

    const names: string[] = [];
    for (let i = 0; i < 60; i++) {
      names.push(ensureDomainUser(`auth-dup-${i}`, 'dup', null, false).name);
    }

    // every signup resolved to a distinct, claimable name
    expect(new Set(names).size).toBe(60);
    // first 51 take the sequential path (dup, dup1…dup50), the rest the random suffix
    expect(names.slice(0, 51)).toEqual(['dup', ...Array.from({ length: 50 }, (_, n) => `dup${n + 1}`)]);
    for (const name of names.slice(51)) expect(name).toMatch(/^dup-[0-9a-f]{8}$/);
  });

  it('still prefers the first free sequential candidate in the common case', async () => {
    seedNamed('taken');
    seedNamed('taken1');
    const ensureDomainUser = await loadEnsureDomainUser();

    expect(ensureDomainUser('auth-easy', 'taken', null, false).name).toBe('taken2');
  });
});
