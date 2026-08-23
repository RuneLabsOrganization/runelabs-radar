import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/user';
import { createWorkspaceBatch } from '@/lib/batches';

export async function POST(req: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { title?: string; description?: string };
  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'title required' }, { status: 400 });
  }
  try {
    const batch = createWorkspaceBatch(user.id, body.title.trim(), body.description);
    return NextResponse.json({ id: batch.id, slug: batch.slug });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 403 });
  }
}
