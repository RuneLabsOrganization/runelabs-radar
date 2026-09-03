import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { jobRuns, kitEvidence, kitPicks } from '@/lib/db/schema';
import { withJobRun } from '@/lib/jobs';
import { runKitGrade } from '@/lib/kits/grade';

// The worker chains withJobRun('kit-prices', ...).then(() => withJobRun('kit-grade', ...)):
// a pricing-feeder throw must land in its own run row and never stop grading.
describe('kit-prices / kit-grade run independence', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  function runRow(job: string) {
    return db.select().from(jobRuns).where(and(eq(jobRuns.job, job))).get();
  }

  it('a failing kit-prices run is recorded separately and kit-grade still grades', async () => {
    const pickId = db
      .insert(kitPicks)
      .values({ category: 'video', task: 'text-to-video', tier: 'value', pickName: 'Kling 3.0', updatedAt: new Date() })
      .returning({ id: kitPicks.id })
      .get()!.id;
    db.insert(kitEvidence)
      .values({ pickId, kind: 'report', sourceUrl: 'https://a.example/1', sentiment: 1, observedAt: new Date() })
      .run();

    const prices = await withJobRun('kit-prices', () => Promise.reject(new Error('pricing feeder down')));
    expect(prices).toBeNull(); // failure swallowed into the run row

    const grades = await withJobRun('kit-grade', () => Promise.resolve(runKitGrade()));
    expect(grades).toEqual({ graded: 1 });

    const priceRun = runRow('kit-prices')!;
    expect(priceRun.status).toBe('error');
    expect(priceRun.error).toContain('pricing feeder down');

    const gradeRun = runRow('kit-grade')!;
    expect(gradeRun.status).toBe('ok');
    expect(JSON.parse(gradeRun.stats!)).toEqual({ graded: 1 });

    // the pick really was graded despite the pricing failure
    expect(db.select().from(kitPicks).all()[0].evidenceCount).toBe(1);
  });
});
