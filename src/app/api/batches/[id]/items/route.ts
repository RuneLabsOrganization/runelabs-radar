import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/user';
import { addToBatch, canModifyBatch, getBatchBySlug } from '@/lib/batches';
import { getDb } from '@/lib/db';
import { batches } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const REF_TYPES = ['opportunity', 'story', 'entity', 'idea'] as const;
type RefType = (typeof REF_TYPES)[number];

function resolveBatch(idOrSlug: string) {
  if (/^\d+$/.test(idOrSlug)) {
    return getDb().select().from(batches).where(eq(batches.id, Number(idOrSlug))).get() ?? null;
  }
  return getBatchBySlug(idOrSlug);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const batch = resolveBatch(id);
  // 404 (not 403) so batch existence doesn't oracle out to other users;
  // system drops (ownerId null) are curated and read-only for everyone.
  if (!batch || !canModifyBatch(batch, user.id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    refType?: unknown;
    refId?: unknown;
    refKey?: unknown;
    ideaText?: unknown;
  };
  if (typeof body.refType !== 'string' || !(REF_TYPES as readonly string[]).includes(body.refType)) {
    return NextResponse.json({ error: `refType must be ${REF_TYPES.join('|')}` }, { status: 400 });
  }
  if (body.refId !== undefined && !Number.isInteger(body.refId)) {
    return NextResponse.json({ error: 'refId must be an integer' }, { status: 400 });
  }
  if (body.refKey !== undefined && typeof body.refKey !== 'string') {
    return NextResponse.json({ error: 'refKey must be a string' }, { status: 400 });
  }
  if (body.ideaText !== undefined && typeof body.ideaText !== 'string') {
    return NextResponse.json({ error: 'ideaText must be a string' }, { status: 400 });
  }
  const item = addToBatch(batch.id, {
    refType: body.refType as RefType,
    refId: body.refId as number | undefined,
    refKey: body.refKey as string | undefined,
    ideaText: body.ideaText as string | undefined,
  });
  return NextResponse.json({ id: item.id });
}
