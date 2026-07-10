import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { loadDotEnv } from '../src/lib/env';
import { getDb } from '../src/lib/db';
import { stories } from '../src/lib/db/schema';
import { chatJSON } from '../src/lib/llm/minimax';
import { sanitizeEntities } from '../src/lib/curate/curate';

loadDotEnv();

const BATCH = 20;

/**
 * One-shot backfill: stories curated before entity extraction existed get
 * their entities in batched LLM calls (BATCH stories per call). New curation
 * extracts entities inline, so this only matters once per deployment.
 */
async function main() {
  const db = getDb();
  const weekAgo = new Date(Date.now() - 7 * 864e5);
  const rows = db
    .select({ id: stories.id, title: stories.title, tldr: stories.tldr })
    .from(stories)
    .where(and(eq(stories.status, 'curated'), isNull(stories.entities), gte(stories.createdAt, weekAgo)))
    .orderBy(desc(stories.createdAt))
    .all();

  console.log(`backfill-entities: ${rows.length} stories to process`);
  let updated = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const system =
      'You extract named entities from AI-news story summaries. For each story, list up to 6 ' +
      'entities as {"name","kind"} with kind one of "model" (AI models), "tool" (products/' +
      'frameworks), "org" (companies/labs), "technique" (methods). Short canonical names. ' +
      'Respond with STRICT JSON only, exactly: {"entities":{"<storyId>":[{"name":"...","kind":"..."}]}} ' +
      'with one key per story id given.';
    const user = batch
      .map((s) => `Story ${s.id}: ${s.title}${s.tldr ? `\n  ${s.tldr}` : ''}`)
      .join('\n');

    try {
      const res = await chatJSON<{ entities?: Record<string, unknown> }>(system, user);
      const map = res.entities ?? {};
      for (const s of batch) {
        const clean = sanitizeEntities(map[String(s.id)]);
        if (clean.length === 0) continue;
        db.update(stories)
          .set({ entities: JSON.stringify(clean) })
          .where(eq(stories.id, s.id))
          .run();
        updated++;
      }
      console.log(`  batch ${Math.floor(i / BATCH) + 1}: ok`);
    } catch (e) {
      console.error(`  batch ${Math.floor(i / BATCH) + 1} failed:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`backfill-entities: updated ${updated} stories`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
