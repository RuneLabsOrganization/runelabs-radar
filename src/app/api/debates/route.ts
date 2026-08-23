import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/user';
import { can } from '@/lib/entitlements';
import { runDebate } from '@/lib/opportunities/critic';

export async function POST(req: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const gate = can(user, 'debate');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason, upgradeHint: gate.upgradeHint }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { idea?: string; opportunityId?: number };
  if (!body.idea?.trim() && !body.opportunityId) {
    return NextResponse.json({ error: 'idea or opportunityId required' }, { status: 400 });
  }
  try {
    const result = await runDebate(body.opportunityId ?? null, body.idea?.trim());
    return NextResponse.json({
      verdict: result.verdict,
      confidence: result.confidence,
      killRisks: result.killRisks,
      conditionsToSucceed: result.conditionsToSucceed,
      strengthenedVariants: result.strengthenedVariants,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
