import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { stories } from '../db/schema';
import { config } from '../config';
import { getIdentity } from '../identity';
import { canonicalEntityKey, canonicalEntityName, entitySlug } from '../entity';

/**
 * All distinct curated entity names, canonical-keyed. ONE query for the whole
 * stacks page — pick↔entity matching happens in JS, never N+1 scans.
 */
export function allEntityNames(): Map<string, string> {
  const db = getDb();
  const rows = db.all<{ name: string }>(
    sql`SELECT DISTINCT e.value->>'name' AS name
        FROM stories s, json_each(s.entities) e
        WHERE s.status = 'curated'`,
  );
  const map = new Map<string, string>();
  for (const r of rows) {
    const k = canonicalEntityKey(r.name);
    if (k && !map.has(k)) map.set(k, canonicalEntityName(r.name));
  }
  return map;
}

/**
 * Find the known entity inside a board/stack pick string ("Kimi K3 (xhigh)" →
 * Kimi K3). Exact canonical-key match first, then longest containment wins
 * (min 4 chars so generic short names like "o3" don't over-link).
 */
export function matchEntity(
  pickText: string,
  entities: Map<string, string>,
): { name: string; slug: string } | null {
  const key = canonicalEntityKey(pickText);
  if (entities.has(key)) {
    const name = entities.get(key)!;
    return { name, slug: entitySlug(name) };
  }
  let best: { name: string; slug: string; len: number } | null = null;
  for (const [k, name] of entities) {
    if (k.length >= 4 && key.includes(k) && (!best || k.length > best.len)) {
      best = { name, slug: entitySlug(name), len: k.length };
    }
  }
  return best;
}

export interface StackLayerMd {
  layer: string;
  pick: string;
  alt: string | null;
  note: string | null;
}

export interface StackMdSource {
  title: string;
  tagline: string | null;
  timeToMvp: string | null;
  costNote: string | null;
  rationale: string | null;
}

/** The clipboard payload for "copy playbook" — clean markdown, attribution tail. */
export function stackMarkdown(ventureLabel: string, s: StackMdSource, layers: StackLayerMd[]): string {
  const id = getIdentity();
  const lines: string[] = [`# ${s.title} — ${ventureLabel}`, ''];
  if (s.tagline) lines.push(s.tagline, '');
  const meta = [s.timeToMvp && `time to mvp: ${s.timeToMvp}`, s.costNote && `run cost: ${s.costNote}`]
    .filter(Boolean)
    .join(' · ');
  if (meta) lines.push(meta, '');
  lines.push('## Stack', '');
  for (const l of layers) {
    lines.push(`- **${l.layer}**: ${l.pick}${l.alt ? ` (alt: ${l.alt})` : ''}${l.note ? ` — ${l.note}` : ''}`);
  }
  if (s.rationale) lines.push('', s.rationale);
  lines.push('', `— via ${id.productName} · ${config.siteUrl}/stacks`);
  return lines.join('\n');
}
