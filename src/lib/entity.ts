import { sql } from 'drizzle-orm';
import { getDb } from './db';

/** "ComfyUI" -> "comfyui" — URL slug for entity watch pages. */
export function entitySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Canonical grouping key for an entity: case-, space- and punctuation-blind,
 * so "GPT-5" ≡ "gpt 5" ≡ "GPT5" all land in one bucket. This is the alias
 * canonicalization layer — extraction writes variants, reads group by key.
 */
export function canonicalEntityKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Explicit aliases (canonicalEntityKey → preferred display name) for variants
 * punctuation-folding can't catch — mostly org-prefix noise. Extend as the
 * feed reveals new dupes; keys must be canonicalEntityKey form.
 */
export const ENTITY_ALIASES: Record<string, string> = {
  openaio3: 'o3',
  openaio4mini: 'o4-mini',
};

/** Display name for an entity: the alias target when known, else the tidied original. */
export function canonicalEntityName(name: string): string {
  const tidied = name.replace(/\s+/g, ' ').trim();
  return ENTITY_ALIASES[canonicalEntityKey(tidied)] ?? tidied;
}

export interface EntityRow {
  name: string;
  kind: string;
  mentions: number;
}

/** Resolve a slug back to the canonical entity (name, kind) from the stories graph. */
export function resolveEntity(slug: string): EntityRow | null {
  const db = getDb();
  const rows = db.all<EntityRow>(
    sql`SELECT e.value->>'name' AS name, e.value->>'kind' AS kind, count(DISTINCT s.id) AS mentions
        FROM stories s, json_each(s.entities) e
        WHERE s.status = 'curated'
        GROUP BY lower(e.value->>'name')`,
  );
  const key = canonicalEntityKey(slug);
  let best: EntityRow | null = null;
  let total = 0;
  for (const row of rows) {
    if (canonicalEntityKey(row.name) !== key) continue;
    total += row.mentions;
    if (!best || row.mentions > best.mentions) best = row;
  }
  if (!best) return null;
  return { name: canonicalEntityName(best.name), kind: best.kind, mentions: total };
}

/** Top entities by mentions in the window — for the sitemap and watch-page links. */
export function topEntitySlugs(limit = 200): string[] {
  const db = getDb();
  const rows = db.all<{ name: string; mentions: number }>(
    sql`SELECT e.value->>'name' AS name, count(DISTINCT s.id) AS mentions
        FROM stories s, json_each(s.entities) e
        WHERE s.status = 'curated'
        GROUP BY lower(e.value->>'name')`,
  );
  // merge name variants ("GPT-5" / "gpt 5") into one entity before ranking;
  // display name = the most-mentioned variant (alias target when known)
  const merged = new Map<string, { name: string; mentions: number; bestVariant: number }>();
  for (const row of rows) {
    const key = canonicalEntityKey(row.name);
    const cur = merged.get(key);
    if (cur) {
      cur.mentions += row.mentions;
      if (row.mentions > cur.bestVariant) {
        cur.bestVariant = row.mentions;
        cur.name = canonicalEntityName(row.name);
      }
    } else {
      merged.set(key, { name: canonicalEntityName(row.name), mentions: row.mentions, bestVariant: row.mentions });
    }
  }
  const seen = new Set<string>();
  return [...merged.values()]
    .sort((a, b) => b.mentions - a.mentions)
    .map((r) => entitySlug(r.name))
    .filter((s) => {
      if (s.length === 0 || seen.has(s)) return false;
      seen.add(s);
      return true;
    })
    .slice(0, limit);
}
