import Link from 'next/link';
import { requireViewer } from '@/lib/auth/user';
import { listBatchesForUser, getBatchItems } from '@/lib/batches';
import { can } from '@/lib/entitlements';
import { paths } from '@/lib/urls';
import { UpgradeWall } from '@/components/UpgradeWall';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CreateBatchForm } from '@/components/batches/CreateBatchForm';

export const metadata = {
  title: 'Batches',
  description: 'Working sets and weekly Radar drops — debate and plan in bulk.',
};

export default async function BatchesPage() {
  const user = await requireViewer();
  const rows = listBatchesForUser(user?.id ?? null);
  const createGate = user ? can(user, 'batch_create') : { ok: false as const, tier: 'free' as const };

  return (
    <div>
      <div className="readout text-phosphor">Build · Batches</div>
      <h1 className="type-h1 mt-1">Batches</h1>
      <p className="mt-2 max-w-xl text-[13.5px] text-ink-3">
        Collect opportunities and ideas into a working set, or browse the weekly Radar Batch drop. Bulk debate and
        plan runs are a Builder feature.
      </p>

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
          const items = getBatchItems(b.id);
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
                    {items.length} item{items.length === 1 ? '' : 's'}
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
