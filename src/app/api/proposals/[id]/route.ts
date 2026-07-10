import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/user';
import { applyProposal, rejectProposal } from '@/lib/board/apply';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const { action } = (body ?? {}) as { action?: unknown };
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const result = action === 'approve' ? await applyProposal(id) : await rejectProposal(id);
  if (!result.ok) {
    return NextResponse.json({ error: 'proposal not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
