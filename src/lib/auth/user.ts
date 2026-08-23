import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { users } from '../db/schema';
import { auth, domainUserFromAuthId, ensureDomainUser } from './better-auth';
import { SESSION_COOKIE, verifySession } from './session';
import { cookies } from 'next/headers';
import { paths } from '../urls';

export type User = typeof users.$inferSelect;

/**
 * Resolve the current domain user from Better Auth session first,
 * falling back to the legacy radar_session cookie for seeded operators.
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user) {
      let domain = domainUserFromAuthId(session.user.id);
      if (!domain) {
        domain = ensureDomainUser(session.user.id, session.user.name, session.user.email) as User;
      }
      return domain;
    }
  } catch {
    // Better Auth not ready / no session
  }

  // Legacy cookie path (CLI-seeded operators during migration)
  const store = await cookies();
  const uid = verifySession(store.get(SESSION_COOKIE)?.value);
  if (!uid) return null;
  return getDb().select().from(users).where(eq(users.id, uid)).get() ?? null;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(paths.login);
  return user;
}

/** JSON API routes: return null instead of redirecting to login. */
export async function requireApiUser(): Promise<User | null> {
  return getCurrentUser();
}

export async function requireViewer(): Promise<User | null> {
  // Product rule: reads are always free — anonymous visitors may browse.
  // Write/generative actions gate via requireUser() + entitlements.can().
  return getCurrentUser();
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== 'admin') redirect(paths.app);
  return user;
}
