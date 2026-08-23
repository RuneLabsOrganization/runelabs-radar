import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/user';
import { addToBatch, getBatchBySlug } from '@/lib/batches';
import { getDb } from '@/lib/db';
import { batches } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

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
  if (!batch || (batch.ownerId !== null && batch.ownerId !== user.id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    refType?: 'opportunity' | 'story' | 'entity' | 'idea';
    refId?: number;
    refKey?: string;
    ideaText?: string;
  };
  if (!body.refType) {
    return NextResponse.json({ error: 'refType required' }, { status: 400 });
  }
  const item = addToBatch(batch.id, {
    refType: body.refType,
    refId: body.refId,
    refKey: body.refKey,
    ideaText: body.ideaText,
  });
  return NextResponse.json({ id: item.id });
}
