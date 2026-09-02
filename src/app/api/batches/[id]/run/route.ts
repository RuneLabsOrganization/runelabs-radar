import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/user';
import { canModifyBatch, runBatchOp } from '@/lib/batches';
import { getDb } from '@/lib/db';
import { batches } from '@/lib/db/schema';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'invalid batch id' }, { status: 400 });
  }
  const batchId = Number(id);
  const body = (await req.json().catch(() => ({}))) as { op?: 'debate' | 'plan' | 'scout' };
  if (!body.op || !['debate', 'plan', 'scout'].includes(body.op)) {
    return NextResponse.json({ error: 'op must be debate|plan|scout' }, { status: 400 });
  }
  const batch = getDb().select().from(batches).where(eq(batches.id, batchId)).get();
  // 404 (not 403) so batch existence doesn't oracle out to other users
  if (!batch || !canModifyBatch(batch, user.id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  try {
    const run = await runBatchOp(batch.id, body.op, user.id);
    return NextResponse.json({ id: run.id, status: run.status, stats: run.stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 403 });
  }
}
