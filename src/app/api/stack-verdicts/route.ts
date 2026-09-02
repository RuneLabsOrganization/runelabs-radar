import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { stacks } from '@/lib/db/schema';
import { getCurrentUser } from '@/lib/auth/user';

const VERDICT_MAX_LENGTH = 500;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // The "RuneLabs verdict" is the site's editorial voice — admin-only.
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const { stackId, verdict } = (body ?? {}) as { stackId?: unknown; verdict?: unknown };
  if (!Number.isInteger(stackId)) {
    return NextResponse.json({ error: 'stackId must be an integer' }, { status: 400 });
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
  const sid = stackId as number;

  const db = getDb();
  const stack = db.select({ id: stacks.id }).from(stacks).where(eq(stacks.id, sid)).get();
  if (!stack) {
    return NextResponse.json({ error: 'stack not found' }, { status: 404 });
  }

  db.update(stacks)
    .set({ runelabsVerdict: trimmed, verdictAuthor: user.name })
    .where(eq(stacks.id, sid))
    .run();

  return NextResponse.json({ ok: true });
}
