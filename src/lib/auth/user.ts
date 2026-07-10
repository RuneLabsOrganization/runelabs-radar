import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { getDb } from '../db';
import { users } from '../db/schema';
import { SESSION_COOKIE, verifySession } from './session';

export type User = typeof users.$inferSelect;

export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const uid = verifySession(store.get(SESSION_COOKIE)?.value);
  if (!uid) return null;
  const db = getDb();
  return db.select().from(users).where(eq(users.id, uid)).get() ?? null;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/**
 * Read-path gate: the signed-in user, or null for anonymous visitors when
 * PUBLIC_MODE=true (read-only — no votes, verdicts, visit tracking or admin).
 * With public mode off this behaves exactly like requireUser.
 */
export async function requireViewer(): Promise<User | null> {
  const user = await getCurrentUser();
  if (user) return user;
  if (config.publicMode) return null;
  redirect('/login');
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== 'admin') redirect('/');
  return user;
}
