import Link from 'next/link';
import { requireViewer } from '@/lib/auth/user';
import { paths } from '@/lib/urls';
import { can } from '@/lib/entitlements';
import { listVisibleDebateCards, loadVisibleDebate } from '@/lib/opportunities/debate-view';
import { UpgradeWall } from '@/components/UpgradeWall';
import DebateTranscript from '@/components/DebateTranscript';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DebateIdeaForm } from '@/components/batches/DebateIdeaForm';

export const metadata = { title: 'Debates' };

export default async function DebatesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await requireViewer();
  const { id: rawId } = await searchParams;
  const selectedId = rawId && /^\d+$/.test(rawId) ? Number(rawId) : null;
  const selected = selectedId != null ? loadVisibleDebate(selectedId, user?.id ?? null) : null;
  const cards = listVisibleDebateCards(user?.id ?? null);

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

      {selected && (
        <div id="transcript" className="mt-8 scroll-mt-20">
          <div className="readout mb-2.5">transcript</div>
          <h2 className="text-[16px] font-semibold tracking-[-0.01em]">
            {selected.opportunitySlug ? (
              <Link href={`${paths.opportunity(selected.opportunitySlug)}#debate`} className="hover:text-phosphor">
                {selected.title}
              </Link>
            ) : (
              selected.title
            )}
          </h2>
          <div className="mt-4">
            <DebateTranscript debate={selected.view} />
          </div>
        </div>
      )}

      <div className="mt-8 space-y-2">
        {cards.map((d) => (
          <Card key={d.id}>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-4">
              <div>
                <CardTitle className="text-[14px]">
                  {d.opportunitySlug ? (
                    <Link href={paths.opportunity(d.opportunitySlug)} className="hover:text-phosphor">
                      {d.title}
                    </Link>
                  ) : (
                    d.title
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
              <Link href={`${paths.debates}?id=${d.id}#transcript`} className="text-[12px] text-phosphor hover:underline">
                View transcript
              </Link>
            </CardContent>
          </Card>
        ))}
        {cards.length === 0 && <p className="text-[13px] text-ink-3">No debates yet.</p>}
      </div>
    </div>
  );
}
