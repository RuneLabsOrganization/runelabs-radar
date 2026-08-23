import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth/user';
import { getBatchBySlug, getBatchItems } from '@/lib/batches';
import { can } from '@/lib/entitlements';
import { paths } from '@/lib/urls';
import { UpgradeWall } from '@/components/UpgradeWall';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { BatchRunControls } from '@/components/batches/BatchRunControls';

export default async function BatchDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const batch = getBatchBySlug(slug);
  if (!batch) notFound();
  const user = await requireViewer();
  const items = getBatchItems(batch.id);
  const runGate = user ? can(user, 'batch_run') : { ok: false as const, reason: 'Sign in required', upgradeHint: undefined };

  // members-only drops: teaser for anonymous
  if (batch.visibility === 'members' && !user) {
    return (
      <div>
        <Badge variant="phosphor">Radar Batch</Badge>
        <div className="readout mt-2 text-phosphor">Build · Batches</div>
        <h1 className="type-h1 mt-1">{batch.title}</h1>
        <p className="mt-2 text-[13px] text-ink-3">{items.length} curated openings this week.</p>
        <div className="mt-6">
          <UpgradeWall reason="Full Radar Batch cohorts are for members. Sign in free to open the list." />
        </div>
        <SectionHeader label="teaser" />
        <ul className="space-y-2">
          {items.slice(0, 3).map((it) => (
            <li key={it.id} className="text-[13px] text-ink-2">
              {it.refKey ?? it.ideaText ?? `Item ${it.position + 1}`}
            </li>
          ))}
          {items.length > 3 && <li className="text-[12px] text-ink-4">+{items.length - 3} more for members</li>}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <div className="readout text-phosphor">Build · Batches</div>
      <div className="mt-1 flex items-center gap-2">
        <Badge variant={batch.kind === 'drop' ? 'phosphor' : 'default'}>{batch.kind}</Badge>
        {batch.cohort && <span className="mono text-[10px] text-ink-4">{batch.cohort}</span>}
      </div>
      <h1 className="type-h1 mt-2">{batch.title}</h1>
      {batch.description && <p className="mt-2 text-[13px] text-ink-3">{batch.description}</p>}

      <SectionHeader label="items" count={items.length} />
      <div className="space-y-2">
        {items.map((it) => (
          <Card key={it.id}>
            <CardContent className="flex items-center justify-between gap-3 p-3">
              <div>
                <div className="mono text-[10px] uppercase tracking-[0.08em] text-ink-4">{it.refType}</div>
                <div className="text-[13.5px] text-ink">
                  {it.refType === 'opportunity' && it.refId ? (
                    <Link href={paths.opportunity(it.refKey ?? it.refId)} className="hover:text-phosphor">
                      {it.refKey ?? `#${it.refId}`}
                    </Link>
                  ) : (
                    it.ideaText ?? it.refKey ?? `#${it.id}`
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && <p className="text-[13px] text-ink-3">Empty batch — add opportunities from Build.</p>}
      </div>

      <SectionHeader label="bulk run" />
      {runGate.ok && user ? (
        <BatchRunControls batchId={batch.id} />
      ) : (
        <UpgradeWall signedIn={!!user} reason={runGate.reason} upgradeHint={runGate.upgradeHint} />
      )}
    </div>
  );
}
