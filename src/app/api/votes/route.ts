import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { stories, votes } from '@/lib/db/schema';
import { getCurrentUser } from '@/lib/auth/user';

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const { storyId, value } = (body ?? {}) as { storyId?: unknown; value?: unknown };
  if (!Number.isInteger(storyId)) {
    return NextResponse.json({ error: 'storyId must be an integer' }, { status: 400 });
  }
  if (value !== 1 && value !== -1 && value !== 0) {
    return NextResponse.json({ error: 'value must be 1, -1 or 0' }, { status: 400 });
  }
  const sid = storyId as number;

  const db = getDb();
  const story = db.select({ id: stories.id }).from(stories).where(eq(stories.id, sid)).get();
  if (!story) {
    return NextResponse.json({ error: 'story not found' }, { status: 404 });
  }

  if (value === 0) {
    db.delete(votes)
      .where(and(eq(votes.userId, user.id), eq(votes.storyId, sid)))
      .run();
  } else {
    db.insert(votes)
      .values({ userId: user.id, storyId: sid, value })
      .onConflictDoUpdate({ target: [votes.userId, votes.storyId], set: { value } })
      .run();
  }

  const rows = db.select({ value: votes.value }).from(votes).where(eq(votes.storyId, sid)).all();
  const up = rows.filter((r) => r.value === 1).length;
  const down = rows.filter((r) => r.value === -1).length;

  return NextResponse.json({ ok: true, up, down });
}
