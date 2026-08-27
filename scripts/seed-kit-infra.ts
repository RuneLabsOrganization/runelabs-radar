import { and, eq } from 'drizzle-orm';
import { loadDotEnv } from '../src/lib/env';
import { getDb } from '../src/lib/db';
import { boardProposals, kitPicks } from '../src/lib/db/schema';
import { applyProposal } from '../src/lib/board/apply';

loadDotEnv();

/**
 * Editorial seed for indie-dev kit infra + connector cells.
 * Writes only through applyProposal so kit_picks history stays honest.
 */
const CELLS = [
  {
    domain: 'connectors',
    task: 'code-repo',
    proposed: {
      bestOverall: 'GitHub',
      bestValue: 'GitHub',
      cheapestViable: 'GitLab',
      costNote: 'Seat or self-host. CI usage not in the kit total.',
    },
    rationale:
      'Everyone already has a git host; GitHub is the default, GitLab is the self-host escape hatch.',
  },
  {
    domain: 'infra',
    task: 'hosting',
    proposed: {
      bestOverall: 'Vercel',
      bestValue: 'Railway',
      cheapestViable: 'Hetzner',
      costNote:
        'Vercel/Railway are usage-priced — excluded from kit total when priceModel is usage.',
    },
    rationale:
      'Vercel is the Next.js default; Railway is simpler paid; Hetzner is the cheap VPS this hub already runs on.',
  },
  {
    domain: 'infra',
    task: 'database-baas',
    proposed: {
      bestOverall: 'Neon',
      bestValue: 'Supabase',
      cheapestViable: 'Turso',
      costNote: 'Serverless Postgres vs SQLite edge.',
    },
    rationale:
      'Neon for branching Postgres; Supabase when you also want auth/storage; Turso when SQLite is enough.',
  },
  {
    domain: 'infra',
    task: 'auth',
    proposed: {
      bestOverall: 'Clerk',
      bestValue: 'Better Auth',
      cheapestViable: 'Better Auth',
      costNote: 'Clerk is a seat product; Better Auth is self-hosted.',
    },
    rationale:
      'Clerk is the hosted default; Better Auth is what Radar itself runs and the cheap escape hatch.',
  },
  {
    domain: 'infra',
    task: 'payments',
    proposed: {
      bestOverall: 'Stripe',
      bestValue: 'Stripe',
      cheapestViable: 'Polar',
      costNote: 'Stripe is usage-priced; Polar is merchant-of-record.',
    },
    rationale: 'Stripe is the default for SaaS; Polar is the cheaper MoR alternative.',
  },
] as const;

async function main() {
  const db = getDb();
  let applied = 0;
  let skipped = 0;

  for (const cell of CELLS) {
    const existingBest = db
      .select()
      .from(kitPicks)
      .where(
        and(
          eq(kitPicks.category, cell.domain),
          eq(kitPicks.task, cell.task),
          eq(kitPicks.tier, 'best'),
        ),
      )
      .get();

    if (existingBest?.pickName) {
      console.log(`[seed-kit-infra] skip ${cell.domain}/${cell.task} (best=${existingBest.pickName})`);
      skipped += 1;
      continue;
    }

    const id = db
      .insert(boardProposals)
      .values({
        domain: cell.domain,
        task: cell.task,
        proposed: JSON.stringify(cell.proposed),
        rationale: cell.rationale,
        status: 'pending',
        createdAt: new Date(),
      })
      .returning()
      .get().id;

    const res = await applyProposal(id);
    if (res.ok) {
      console.log(`[seed-kit-infra] applied ${cell.domain}/${cell.task} (proposal #${id})`);
      applied += 1;
    } else {
      console.error(`[seed-kit-infra] apply failed ${cell.domain}/${cell.task} (proposal #${id})`);
    }
  }

  console.log(`[seed-kit-infra] done: applied=${applied} skipped=${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
