import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { entitySlug } from '../entity';

/**
 * Evidence rows come from the opportunity engine as {type, label} text —
 * entity labels are "Name (N mentions)", story labels are title prefixes.
 * This adds hrefs so dossiers drill into the underlying intelligence.
 */

export interface EvidenceItem {
  type: string;
  label: string;
  href?: string | null;
}

/** "MiniMax H3 (6 mentions)" → "MiniMax H3"; plain labels pass through. */
export function entityNameFromLabel(label: string): string | null {
  const trimmed = label.trim();
  const m = /^(.*?)\s*\(\d+\s+mentions?\)$/i.exec(trimmed);
  const name = (m ? m[1] : trimmed).trim();
  return name.length > 0 ? name : null;
}

export function entityEvidenceHref(label: string): string | null {
  const name = entityNameFromLabel(label);
  return name ? `/entity/${entitySlug(name)}` : null;
}

/**
 * Server-side: enrich evidence with hrefs. Entity evidence links to its watch
 * page; story evidence links to the latest curated story whose title starts
 * with the label (labels are stored as title prefixes, possibly ellipsized).
 * Pain/pattern/market/launches evidence has no target → href null.
 */
export function enrichEvidence(items: { type: string; label: string }[]): EvidenceItem[] {
  return items.map((e) => {
    if (e.type === 'entity') return { ...e, href: entityEvidenceHref(e.label) };
    if (e.type === 'story') {
      const prefix = e.label.replace(/…$/, '').trim().slice(0, 60);
      if (prefix.length < 8) return { ...e, href: null };
      const row = getDb().get<{ id: number }>(
        sql`SELECT id FROM stories WHERE status = 'curated' AND title LIKE ${prefix + '%'}
            ORDER BY created_at DESC LIMIT 1`,
      );
      return { ...e, href: row ? `/story/${row.id}` : null };
    }
    return { ...e, href: null };
  });
}
