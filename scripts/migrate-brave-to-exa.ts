/**
 * Migrates the 9 existing "Brave — X" source rows to the exa adapter
 * (Exa primary, Brave fallback — src/lib/ingest/adapters/exa.ts) and renames
 * them to "Search — X" to match, and adds the 4 new copy/ads community
 * sources. Seed-data only applies to a fresh database, so production needs
 * this run once by hand — same reasoning as add-feeder-b-sources.ts.
 *
 * Idempotent: renamed/retyped rows are matched by their NEW name on a re-run
 * and skipped; the new sources insert only if their name doesn't exist yet.
 *
 * Usage: npx tsx scripts/migrate-brave-to-exa.ts
 */
import { eq } from 'drizzle-orm';
import { loadDotEnv } from '../src/lib/env';
import { getDb } from '../src/lib/db';
import { sources } from '../src/lib/db/schema';
import { SEED_SOURCES } from '../src/lib/db/seed-data';

loadDotEnv();

const RENAMES: Record<string, string> = {
  'Brave — Coding AI': 'Search — Coding AI',
  'Brave — Copy AI': 'Search — Copy AI',
  'Brave — Image AI': 'Search — Image AI',
  'Brave — Video AI': 'Search — Video AI',
  'Brave — Ads AI': 'Search — Ads AI',
  'Brave — Agentic AI': 'Search — Agentic AI',
  'Brave — Frontier Watch': 'Search — Frontier Watch',
  'Brave — Audio AI': 'Search — Audio AI',
  'Brave — Dev Infra': 'Search — Dev Infra',
  'Brave — MCP Servers': 'Search — MCP Servers',
};

const NEW_SOURCE_NAMES = ['r/copywriting', 'r/PPC', 'r/advertising', 'r/DigitalMarketing'];

const db = getDb();
let retyped = 0;
let added = 0;

for (const [oldName, newName] of Object.entries(RENAMES)) {
  const already = db.select({ id: sources.id }).from(sources).where(eq(sources.name, newName)).get();
  if (already) {
    console.log(`skip (already migrated): ${newName}`);
    continue;
  }
  const old = db.select({ id: sources.id }).from(sources).where(eq(sources.name, oldName)).get();
  if (!old) {
    console.log(`skip (no row named "${oldName}" — nothing to migrate)`);
    continue;
  }
  db.update(sources).set({ type: 'exa', name: newName }).where(eq(sources.id, old.id)).run();
  console.log(`retyped + renamed: ${oldName} -> ${newName} (exa)`);
  retyped++;
}

for (const name of NEW_SOURCE_NAMES) {
  const seed = SEED_SOURCES.find((s) => s.name === name);
  if (!seed) {
    console.error(`no SEED_SOURCES entry named "${name}" — seed-data.ts may have changed`);
    continue;
  }
  const existing = db.select({ id: sources.id }).from(sources).where(eq(sources.name, name)).get();
  if (existing) {
    console.log(`skip (exists): ${name}`);
    continue;
  }
  db.insert(sources)
    .values({
      type: seed.type,
      name: seed.name,
      config: JSON.stringify(seed.config ?? {}),
      domainHints: JSON.stringify(seed.domainHints ?? []),
      enabled: true,
    })
    .run();
  console.log(`added: ${name}`);
  added++;
}

console.log(`\n${retyped} source(s) migrated to exa, ${added} new source(s) added.`);
if (retyped > 0 || added > 0) {
  console.log('Reminder: set EXA_API_KEY in .env for the exa adapter to work (BRAVE_API_KEY stays as fallback).');
}
