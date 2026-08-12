import { sql } from 'drizzle-orm';
import { getDb } from './db';

/** "ComfyUI" -> "comfyui" — URL slug for entity watch pages. */
export function entitySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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
        GROUP BY lower(e.value->>'name')
        HAVING lower(e.value->>'name') = lower(${slug.replace(/-/g, ' ')})
           OR replace(lower(e.value->>'name'), ' ', '-') = ${slug}
        ORDER BY mentions DESC
        LIMIT 1`,
  );
  return rows[0] ?? null;
}

/** Top entities by mentions in the window — for the sitemap and watch-page links. */
export function topEntitySlugs(limit = 200): string[] {
  const db = getDb();
  const rows = db.all<{ name: string }>(
    sql`SELECT e.value->>'name' AS name, count(DISTINCT s.id) AS mentions
        FROM stories s, json_each(s.entities) e
        WHERE s.status = 'curated'
        GROUP BY lower(e.value->>'name')
        ORDER BY mentions DESC
        LIMIT ${limit}`,
  );
  return rows.map((r) => entitySlug(r.name)).filter((s) => s.length > 0);
}
