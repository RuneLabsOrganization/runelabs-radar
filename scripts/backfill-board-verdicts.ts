/**
 * One-time backfill: every board_entries row with no verdict gets one from
 * its most recently approved board_proposals.rationale. Going forward,
 * applyProposal() keeps this in sync automatically (src/lib/board/apply.ts) —
 * this script only exists because the auto-fill logic didn't exist yet when
 * the 17 seed cells were first approved, so their rationale was discarded at
 * approval time instead of landing on the board.
 *
 * Never touches a row a human has already written a verdict for (see
 * AUTO_VERDICT_AUTHOR in apply.ts) — same non-destructive rule as the
 * forward path. Safe to re-run.
 *
 * Usage: npx tsx scripts/backfill-board-verdicts.ts
 */
import { and, desc, eq } from 'drizzle-orm';
import { loadDotEnv } from '../src/lib/env';
import { getDb } from '../src/lib/db';
import { boardEntries, boardProposals } from '../src/lib/db/schema';
import { AUTO_VERDICT_AUTHOR } from '../src/lib/board/apply';

loadDotEnv();

const db = getDb();
let filled = 0;
let skippedNoProposal = 0;

for (const row of db.select().from(boardEntries).all()) {
  if (row.runelabsVerdict) continue; // already has one — human or auto, leave it

  const latest = db
    .select()
    .from(boardProposals)
    .where(
      and(
        eq(boardProposals.domain, row.domain),
        eq(boardProposals.task, row.task),
        eq(boardProposals.status, 'approved'),
      ),
    )
    .orderBy(desc(boardProposals.createdAt))
    .limit(1)
    .get();

  if (!latest) {
    console.log(`no approved proposal for ${row.domain}/${row.task} — leaving blank`);
    skippedNoProposal++;
    continue;
  }

  db.update(boardEntries)
    .set({ runelabsVerdict: latest.rationale, verdictAuthor: AUTO_VERDICT_AUTHOR, updatedAt: new Date() })
    .where(eq(boardEntries.id, row.id))
    .run();
  console.log(`filled: ${row.domain}/${row.task}`);
  filled++;
}

console.log(`\n${filled} verdict(s) backfilled, ${skippedNoProposal} cell(s) had no approved proposal to draw from.`);
