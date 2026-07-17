import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth/user';
import { config } from '@/lib/config';
import { getDb } from '@/lib/db';
import { opportunities } from '@/lib/db/schema';
import { generateBrief, sanitizeBrief } from '@/lib/opportunities/brief';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const oppId = Number(id);
  if (!Number.isInteger(oppId)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  // mirror page visibility: anonymous access exists only in PUBLIC_MODE
  const user = await getCurrentUser();
  if (!user && !config.publicMode) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const opp = db.select().from(opportunities).where(eq(opportunities.id, oppId)).get();
  if (!opp) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // cached briefs are readable by anyone who can see the page…
  if (opp.brief) {
    try {
      const cached = sanitizeBrief(JSON.parse(opp.brief));
      if (cached) return NextResponse.json({ brief: cached });
    } catch {
      // corrupt cache — generateBrief regenerates over it (guarded internally)
    }
  }

  // …but GENERATION costs LLM calls — anonymous visitors can't trigger it
  if (!user) {
    return NextResponse.json({ error: 'sign in to generate the brief' }, { status: 401 });
  }

  try {
    const res = await generateBrief(oppId);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
    return NextResponse.json({ brief: res.brief });
  } catch (e) {
    console.error('[api] brief generation crashed:', e);
    return NextResponse.json({ error: 'generation failed — try again shortly' }, { status: 502 });
  }
}
