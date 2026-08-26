/**
 * Adds the Feeder B ingest sources that ship in SEED_SOURCES (seed-data.ts)
 * but only take effect on a fresh database — production was seeded long ago
 * and never re-seeds. Mirrors exactly what Admin -> Sources -> add does
 * (src/app/api/sources/route.ts): skip a name that already exists, insert
 * otherwise. Safe to re-run.
 *
 * Usage: npx tsx scripts/add-feeder-b-sources.ts
 */
import { eq } from 'drizzle-orm';
import { loadDotEnv } from '../src/lib/env';
import { getDb } from '../src/lib/db';
import { sources } from '../src/lib/db/schema';
import { SEED_SOURCES } from '../src/lib/db/seed-data';

loadDotEnv();

const FEEDER_B_NAMES = ['Brave — Audio AI', 'Brave — Dev Infra', 'Brave — MCP Servers', 'r/webdev'];

const db = getDb();
let added = 0;

for (const name of FEEDER_B_NAMES) {
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

console.log(`\n${added} source(s) added.`);
