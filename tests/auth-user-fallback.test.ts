import { beforeEach, describe, expect, it, vi } from 'vitest';
import { users } from '@/lib/db/schema';
import { signSession } from '@/lib/auth/session';
import { getCurrentUser } from '@/lib/auth/user';
import { useTestDb } from './helpers/db';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  cookieValue: { value: undefined as string | undefined },
}));

// React.cache memoizes per RSC request; under vitest there is no request
// scope, so swap it for the identity to call the wrapped function directly.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: (fn: unknown) => fn };
});

// next/navigation and next/headers cannot load their real modules under
// vitest's node environment (no request scope).
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => (mocks.cookieValue.value ? { value: mocks.cookieValue.value } : undefined),
  }),
}));

vi.mock('@/lib/auth/better-auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
  domainUserFromAuthId: vi.fn(),
  ensureDomainUser: vi.fn(),
}));

let db: ReturnType<typeof useTestDb>;

beforeEach(() => {
  db = useTestDb();
  mocks.getSession.mockReset();
  mocks.cookieValue.value = undefined;
});

function seedLegacyUser(): number {
  return db.insert(users).values({ name: 'operator', passwordHash: 'x', role: 'admin' }).returning({ id: users.id })
    .get().id;
}

describe('getCurrentUser fallback logging', () => {
  it('logs the error when better-auth getSession throws, then still falls back', async () => {
    const uid = seedLegacyUser();
    mocks.cookieValue.value = signSession(uid);
    const failure = new Error('database is down');
    mocks.getSession.mockRejectedValue(failure);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const user = await getCurrentUser();

    expect(err).toHaveBeenCalledWith(expect.stringContaining('getSession failed'), failure);
    // legacy cookie fallback still resolves the viewer
    expect(user?.id).toBe(uid);
    err.mockRestore();
  });

  it('falls back to the legacy cookie without logging when there is simply no session', async () => {
    const uid = seedLegacyUser();
    mocks.cookieValue.value = signSession(uid);
    mocks.getSession.mockResolvedValue(null);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const user = await getCurrentUser();

    expect(user?.id).toBe(uid);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('logs and returns null when getSession throws and no legacy cookie exists', async () => {
    mocks.getSession.mockRejectedValue(new Error('boom'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(getCurrentUser()).resolves.toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});
