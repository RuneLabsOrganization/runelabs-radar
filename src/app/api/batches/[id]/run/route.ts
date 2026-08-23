import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/user';
import { runBatchOp } from '@/lib/batches';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const batchId = Number(id);
  if (!Number.isFinite(batchId)) {
    return NextResponse.json({ error: 'invalid batch id' }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { op?: 'debate' | 'plan' | 'scout' };
  if (!body.op || !['debate', 'plan', 'scout'].includes(body.op)) {
    return NextResponse.json({ error: 'op must be debate|plan|scout' }, { status: 400 });
  }
  try {
    const run = await runBatchOp(batchId, body.op, user.id);
    return NextResponse.json({ id: run.id, status: run.status, stats: run.stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 403 });
  }
}
