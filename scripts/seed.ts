import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { loadDotEnv } from '../src/lib/env';
import { getDb } from '../src/lib/db';

loadDotEnv();
import { users, sources, boardEntries } from '../src/lib/db/schema';
import { SEED_SOURCES, SEED_BOARD_TASKS } from '../src/lib/db/seed-data';
import { DOMAINS } from '../src/lib/domains';
import { seedWedges } from '../src/lib/opportunities/wedges';

async function main() {
  const args = process.argv.slice(2);
  const adminIdx = args.indexOf('--admin');
  const db = getDb();

  if (adminIdx !== -1) {
    const name = args[adminIdx + 1];
    const password = args[adminIdx + 2];
    if (!name || !password) {
      console.error('Usage: npm run seed -- --admin <name> <password>');
      process.exit(1);
    }
    const passwordHash = bcrypt.hashSync(password, 10);
    const existing = db.select().from(users).where(eq(users.name, name)).get();
    if (existing) {
      db.update(users).set({ passwordHash, role: 'admin' }).where(eq(users.id, existing.id)).run();
      console.log(`Updated admin user "${name}"`);
    } else {
      db.insert(users).values({ name, passwordHash, role: 'admin' }).run();
      console.log(`Created admin user "${name}"`);
    }
  }

  let newSources = 0;
  for (const s of SEED_SOURCES) {
    const inserted = db
      .insert(sources)
      .values({
        type: s.type,
        name: s.name,
        config: JSON.stringify(s.config),
        domainHints: JSON.stringify(s.domainHints),
      })
      .onConflictDoNothing()
      .run();
    if (inserted.changes > 0) newSources++;
  }

  let newEntries = 0;
  for (const domain of DOMAINS) {
    for (const task of SEED_BOARD_TASKS[domain]) {
      const inserted = db
        .insert(boardEntries)
        .values({ domain, task })
        .onConflictDoNothing()
        .run();
      if (inserted.changes > 0) newEntries++;
    }
  }

  const wedgeCount = seedWedges();
  console.log(`[seed] wedge taxonomy: ${wedgeCount} value(s) installed`);

  console.log(`Seeded: ${newSources} new sources, ${newEntries} new board entries`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
