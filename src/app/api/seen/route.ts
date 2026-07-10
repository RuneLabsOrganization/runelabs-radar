import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { getCurrentUser } from '@/lib/auth/user';
import { VISIT_GAP_MS } from '@/lib/visits';

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const now = new Date();
  const newVisit = !user.lastSeenAt || now.getTime() - user.lastSeenAt.getTime() > VISIT_GAP_MS;
  if (newVisit) {
    // New visit: the old lastSeenAt becomes the stable "since your last visit" anchor.
    db.update(users)
      .set({ prevSeenAt: user.lastSeenAt, lastSeenAt: now })
      .where(eq(users.id, user.id))
      .run();
  } else {
    // Heartbeat within the current visit; the anchor (prevSeenAt) stays put.
    db.update(users).set({ lastSeenAt: now }).where(eq(users.id, user.id)).run();
  }

  return NextResponse.json({ ok: true });
}
