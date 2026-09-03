import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/user';
import { createWorkspaceBatch } from '@/lib/batches';

// caps mirror the MCP create_batch tool (mcp/tools/batches.ts)
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 500;

/** Entitlement gate failures (quota/limit) are safe to surface; anything else is internal. */
const GATE_ERROR = /limit reached/i;

export async function POST(req: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { title?: string; description?: string };
  const title = body.title?.trim() ?? '';
  if (!title) {
    return NextResponse.json({ error: 'title required' }, { status: 400 });
  }
  if (title.length > TITLE_MAX) {
    return NextResponse.json({ error: `title too long (max ${TITLE_MAX})` }, { status: 400 });
  }
  if (typeof body.description === 'string' && body.description.length > DESCRIPTION_MAX) {
    return NextResponse.json({ error: `description too long (max ${DESCRIPTION_MAX})` }, { status: 400 });
  }
  try {
    const batch = createWorkspaceBatch(user.id, title, body.description);
    return NextResponse.json({ id: batch.id, slug: batch.slug });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (GATE_ERROR.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    console.error('[api/batches] create failed:', e);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
