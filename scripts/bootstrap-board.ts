import { and, eq } from 'drizzle-orm';
import { loadDotEnv } from '../src/lib/env';
import { getDb } from '../src/lib/db';
import { boardEntries, boardProposals } from '../src/lib/db/schema';
import { applyProposal } from '../src/lib/board/apply';

loadDotEnv();

/**
 * One-shot bootstrap: auto-approves pending proposals whose target board entry
 * is still completely empty, so a fresh install gets a populated board without
 * waiting on manual review. Proposals against already-curated entries stay
 * pending for the admin queue.
 */
async function main() {
  const db = getDb();
  const pending = db.select().from(boardProposals).where(eq(boardProposals.status, 'pending')).all();
  let applied = 0;
  let leftPending = 0;
  for (const p of pending) {
    const entry = db
      .select()
      .from(boardEntries)
      .where(and(eq(boardEntries.domain, p.domain), eq(boardEntries.task, p.task)))
      .get();
    const empty =
      !entry || (!entry.bestOverall && !entry.bestValue && !entry.cheapestViable && !entry.costNote);
    if (empty) {
      const res = await applyProposal(p.id);
      if (res.ok) applied += 1;
      else leftPending += 1;
    } else {
      leftPending += 1;
    }
  }
  console.log(`bootstrap-board: applied ${applied}, left for review ${leftPending}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
