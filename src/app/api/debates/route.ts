import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/user';
import { can } from '@/lib/entitlements';
import { LlmError } from '@/lib/llm/minimax';
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
    const result = await runDebate(body.opportunityId ?? null, body.idea?.trim(), user.id, 'debate', {
      // a signed-in web user is entitled to AA market prices (same bar as an
      // authenticated MCP caller)
      marketVisible: true,
    });
    return NextResponse.json({
      verdict: result.verdict,
      confidence: result.confidence,
      killRisks: result.killRisks,
      conditionsToSucceed: result.conditionsToSucceed,
      strengthenedVariants: result.strengthenedVariants,
    });
  } catch (e) {
    // Domain errors thrown by the debate pipeline itself carry stable,
    // caller-safe messages — map them; everything else (LLM/provider/DB
    // internals) is logged server-side and returned as a generic 500.
    if (e instanceof LlmError && !e.retryable) {
      if (/^opportunity \d+ not found$/.test(e.message)) {
        return NextResponse.json({ error: e.message }, { status: 404 });
      }
      if (e.message.startsWith('debate needs an opportunity id')) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
    }
    console.error('[api/debates] POST failed:', e);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
