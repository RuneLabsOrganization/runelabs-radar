import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/user';
import { clusterStories } from '@/lib/analytics';
import { config } from '@/lib/config';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clusterId = Number(id);
  if (!Number.isInteger(clusterId)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  // read access mirrors page visibility
  const user = await getCurrentUser();
  if (!user && !config.publicMode) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ stories: clusterStories(clusterId) });
}
