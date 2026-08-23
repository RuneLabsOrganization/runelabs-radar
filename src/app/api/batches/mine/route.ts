import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/user';
import { listBatchesForUser } from '@/lib/batches';

export async function GET() {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const rows = listBatchesForUser(user.id).filter((b) => b.kind === 'workspace');
  return NextResponse.json({
    batches: rows.map((b) => ({ slug: b.slug, title: b.title, id: b.id })),
  });
}
