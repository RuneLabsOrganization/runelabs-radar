import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { debates, opportunities } from '@/lib/db/schema';
import { paths } from '@/lib/urls';
import { can } from '@/lib/entitlements';
import { UpgradeWall } from '@/components/UpgradeWall';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DebateIdeaForm } from '@/components/batches/DebateIdeaForm';

export const metadata = { title: 'Debates' };

export default async function DebatesPage() {
  const user = await requireViewer();
  const rows = getDb()
    .select({
      id: debates.id,
      opportunityId: debates.opportunityId,
      ideaText: debates.ideaText,
      verdict: debates.verdict,
      confidence: debates.confidence,
      createdAt: debates.createdAt,
    })
    .from(debates)
    .orderBy(desc(debates.createdAt))
    .limit(40)
    .all();

  const oppTitles = new Map(
    getDb()
      .select({ id: opportunities.id, title: opportunities.title, slug: opportunities.slug })
      .from(opportunities)
      .all()
      .map((o) => [o.id, o]),
  );

  const gate = user ? can(user, 'debate') : { ok: false as const, reason: 'Sign in to run debates', upgradeHint: undefined };

  return (
    <div>
      <div className="readout text-phosphor">Build · Debates</div>
      <h1 className="type-h1 mt-1">Debates</h1>
      <p className="mt-2 max-w-xl text-[13.5px] text-ink-3">
        Advocate → Skeptic → Market Realist → Judge. Pressure-test ideas before you commit a plan.
      </p>

      <div className="mt-6">
        {gate.ok && user ? <DebateIdeaForm /> : <UpgradeWall signedIn={!!user} reason={gate.reason} upgradeHint={gate.upgradeHint} />}
      </div>

      <div className="mt-8 space-y-2">
        {rows.map((d) => {
          const opp = d.opportunityId ? oppTitles.get(d.opportunityId) : null;
          return (
            <Card key={d.id}>
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-4">
                <div>
                  <CardTitle className="text-[14px]">
                    {opp ? (
                      <Link href={paths.opportunity(opp.slug)} className="hover:text-phosphor">
                        {opp.title}
                      </Link>
                    ) : (
                      (d.ideaText ?? 'Free-text idea').slice(0, 120)
                    )}
                  </CardTitle>
                  <div className="mono mt-1 text-[10px] text-ink-4">{d.createdAt.toISOString().slice(0, 10)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={d.verdict === 'pursue' ? 'phosphor' : d.verdict === 'reject' ? 'alert' : 'amber'}>
                    {d.verdict}
                  </Badge>
                  <span className="mono text-[10px] text-ink-4">{d.confidence}%</span>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <Link href={`${paths.debates}?id=${d.id}`} className="text-[12px] text-phosphor hover:underline">
                  View transcript
                </Link>
              </CardContent>
            </Card>
          );
        })}
        {rows.length === 0 && <p className="text-[13px] text-ink-3">No debates yet.</p>}
      </div>
    </div>
  );
}
