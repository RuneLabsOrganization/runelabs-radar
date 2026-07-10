import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { boardEntries } from '@/lib/db/schema';
import { getCurrentUser } from '@/lib/auth/user';

const VERDICT_MAX_LENGTH = 500;

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

  const { entryId, verdict } = (body ?? {}) as { entryId?: unknown; verdict?: unknown };
  if (!Number.isInteger(entryId)) {
    return NextResponse.json({ error: 'entryId must be an integer' }, { status: 400 });
  }
  if (typeof verdict !== 'string') {
    return NextResponse.json({ error: 'verdict must be a string' }, { status: 400 });
  }
  const trimmed = verdict.trim();
  if (trimmed.length > VERDICT_MAX_LENGTH) {
    return NextResponse.json(
      { error: `verdict must be at most ${VERDICT_MAX_LENGTH} characters` },
      { status: 400 },
    );
  }
  const eid = entryId as number;

  const db = getDb();
  const entry = db
    .select({ id: boardEntries.id })
    .from(boardEntries)
    .where(eq(boardEntries.id, eid))
    .get();
  if (!entry) {
    return NextResponse.json({ error: 'entry not found' }, { status: 404 });
  }

  db.update(boardEntries)
    .set({ runelabsVerdict: trimmed, verdictAuthor: user.name, updatedAt: new Date() })
    .where(eq(boardEntries.id, eid))
    .run();

  return NextResponse.json({ ok: true });
}
