// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import Link from 'next/link';
import { inArray } from 'drizzle-orm';
import { requireViewer } from '@/lib/auth/user';
import { getDb } from '@/lib/db';
import { batchItems } from '@/lib/db/schema';
import { listBatchesForUser } from '@/lib/batches';
import { can } from '@/lib/entitlements';
import { paths } from '@/lib/urls';
import { UpgradeWall } from '@/components/UpgradeWall';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CreateBatchForm } from '@/components/batches/CreateBatchForm';
import PageHeader from '@/components/PageHeader';

export const metadata = {
  title: 'Batches',
  description: 'Working sets and weekly Radar drops — debate and plan in bulk.',
};

export default async function BatchesPage() {
  const user = await requireViewer();
  const rows = listBatchesForUser(user?.id ?? null);
  const createGate = user ? can(user, 'batch_create') : { ok: false as const, tier: 'free' as const };

  // one grouped query for every card's item count — a per-row getBatchItems
  // call in the render loop is an N+1 on this index
  const batchIds = rows.map((b) => b.id);
  const itemRows = batchIds.length
    ? getDb()
        .select({ batchId: batchItems.batchId })
        .from(batchItems)
        .where(inArray(batchItems.batchId, batchIds))
        .all()
    : [];
  const itemCounts = new Map<number, number>();
  for (const r of itemRows) itemCounts.set(r.batchId, (itemCounts.get(r.batchId) ?? 0) + 1);

  return (
    <div>
      <PageHeader
        kicker="Build · Batches"
        title="Batches"
        description="Collect opportunities and ideas into a working set, or browse the weekly Radar Batch drop. Bulk debate and plan runs are a Builder feature."
      />

      {user && createGate.ok && (
        <div className="mt-6">
          <CreateBatchForm />
        </div>
      )}
      {user && !createGate.ok && (
        <div className="mt-6">
          <UpgradeWall signedIn reason={createGate.reason} upgradeHint={createGate.upgradeHint} />
        </div>
      )}
      {!user && (
        <div className="mt-6">
          <UpgradeWall reason="Sign in to create workspace batches. Weekly Radar drops are visible below." />
        </div>
      )}

      <div className="mt-8 grid gap-3">
        {rows.length === 0 && (
          <EmptyState
            kicker="nothing here yet"
            title="No batches yet"
            description="A batch works several ideas at once instead of one at a time. The next weekly drop lands Monday, or sign in and start your own whenever you like."
          />
        )}
        {rows.map((b) => {
          const itemCount = itemCounts.get(b.id) ?? 0;
          return (
            <Card key={b.id} className="hover-raise">
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant={b.kind === 'drop' ? 'phosphor' : 'default'}>{b.kind}</Badge>
                    {b.cohort && <span className="mono text-[10px] text-ink-4">{b.cohort}</span>}
                  </div>
                  <CardTitle className="mt-2">
                    <Link href={paths.batch(b.slug)} className="hover:text-phosphor">
                      {b.title}
                    </Link>
                  </CardTitle>
                  <CardDescription>
                    {itemCount} item{itemCount === 1 ? '' : 's'}
                    {b.description ? ` · ${b.description}` : ''}
                  </CardDescription>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={paths.batch(b.slug)}>Open</Link>
                </Button>
              </CardHeader>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
