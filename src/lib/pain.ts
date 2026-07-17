import { and, desc, eq, gte, inArray, or } from 'drizzle-orm';
import { getDb } from './db';
import { comps, items, painPoints, sources, stories } from './db/schema';
import { DOMAINS } from './domains';
import { chatJSON } from './llm/minimax';
import { promptLine } from './prompt-hygiene';

const ITEM_CAP = 120;
const BATCH = 40;
const COMP_CAP = 15;

export interface PainDraft {
  summary: string;
  sector: string | null;
  itemIndexes: number[];
}

/** Validates the LLM's pain extraction. Exported for tests. */
export function sanitizePains(v: unknown, batchSize: number): PainDraft[] {
  if (!Array.isArray(v)) return [];
  const out: PainDraft[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (out.length >= 15) break;
    if (typeof raw !== 'object' || raw === null) continue;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.summary !== 'string') continue;
    // promptLine collapses newlines — pain summaries flow into later prompts
    const summary = promptLine(rec.summary, 200);
    if (summary.length < 10 || seen.has(summary.toLowerCase())) continue;
    seen.add(summary.toLowerCase());
    const sector =
      typeof rec.sector === 'string' && (DOMAINS as readonly string[]).includes(rec.sector)
        ? rec.sector
        : null;
    const itemIndexes = Array.isArray(rec.itemIndexes)
      ? [...new Set(rec.itemIndexes)]
          .filter((i): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < batchSize)
          .slice(0, 5)
      : [];
    out.push({ summary, sector, itemIndexes });
  }
  return out;
}

/** Newest-first evidence merge, deduped by url, capped. Exported for tests. */
export function mergeEvidence(
  prior: { title: string; url: string }[],
  next: { title: string; url: string }[],
  cap = 10,
): { title: string; url: string }[] {
  const seen = new Set<string>();
  const out: { title: string; url: string }[] = [];
  for (const e of [...next, ...prior]) {
    if (!e?.url || seen.has(e.url)) continue;
    seen.add(e.url);
    out.push(e);
    if (out.length >= cap) break;
  }
  return out;
}

export interface CompDraft {
  kind: 'exit' | 'revenue';
  product: string;
  amountUsd: number | null;
  note: string | null;
}

/** Validates the LLM's comps extraction. Exported for tests. */
export function sanitizeComps(v: unknown): CompDraft[] {
  if (!Array.isArray(v)) return [];
  const out: CompDraft[] = [];
  for (const raw of v) {
    if (out.length >= 10) break;
    if (typeof raw !== 'object' || raw === null) continue;
    const rec = raw as Record<string, unknown>;
    if ((rec.kind !== 'exit' && rec.kind !== 'revenue') || typeof rec.product !== 'string') continue;
    const product = rec.product.trim().slice(0, 100);
    if (!product) continue;
    out.push({
      kind: rec.kind,
      product,
      amountUsd:
        typeof rec.amountUsd === 'number' && rec.amountUsd > 0 && rec.amountUsd < 1e10
          ? rec.amountUsd
          : null,
      note: typeof rec.note === 'string' ? rec.note.trim().slice(0, 200) : null,
    });
  }
  return out;
}

/**
 * Daily pain mining: LLM-extract unmet paid needs from the last day of
 * Reddit/HN discussion, dedup against known pains (exact-normalized v1;
 * embedding dedup arrives with the science layer), plus exit/revenue comps
 * from money-mentioning curated stories.
 */
export async function runPain(): Promise<{ pains: number; comps: number }> {
  const db = getDb();
  const dayAgo = new Date(Date.now() - 864e5);

  const discussion = db
    .select({ title: items.title, excerpt: items.excerpt, url: items.url })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(and(gte(items.fetchedAt, dayAgo), inArray(sources.type, ['reddit', 'hn'])))
    .orderBy(desc(items.id))
    .limit(ITEM_CAP)
    .all();

  const existing = db.select().from(painPoints).all();
  const byNorm = new Map(existing.map((p) => [p.summary.toLowerCase(), p]));

  let painCount = 0;
  for (let i = 0; i < discussion.length; i += BATCH) {
    const batch = discussion.slice(i, i + BATCH);
    const system =
      'You mine product-opportunity signals for Runelabs, a startup farm. From the discussion ' +
      'items, extract UNMET NEEDS someone would plausibly PAY to solve — complaints about missing ' +
      'tools, workflow friction, "I wish X existed", "is there a tool that…". Ignore drama, memes ' +
      'and pure opinion. Each need: {"summary": imperative need statement (max ~25 words), ' +
      `"sector": one of ${DOMAINS.join('|')} or omit, "itemIndexes": indexes of the items that ` +
      'evidence it}.\n' +
      'Respond with STRICT JSON only: {"pains":[{"summary":"...","sector":"...","itemIndexes":[0]}]}';
    const user = batch
      .map((d, idx) => `[${idx}] ${d.title}${d.excerpt ? ` — ${d.excerpt.slice(0, 200)}` : ''}`)
      .join('\n');
    try {
      const res = await chatJSON<{ pains?: unknown }>(system, user);
      for (const p of sanitizePains(res.pains, batch.length)) {
        const evidence = p.itemIndexes.map((idx) => ({ title: batch[idx].title, url: batch[idx].url }));
        const match = byNorm.get(p.summary.toLowerCase());
        if (match) {
          const merged = mergeEvidence(
            JSON.parse(match.evidence) as { title: string; url: string }[],
            evidence,
          );
          const updated = db
            .update(painPoints)
            .set({
              intensity: match.intensity + 1,
              lastSeenAt: new Date(),
              evidence: JSON.stringify(merged),
            })
            .where(eq(painPoints.id, match.id))
            .returning()
            .get();
          // keep the cache fresh — a later batch matching the same summary
          // must not clobber this update (lost-update bug caught in review)
          if (updated) byNorm.set(p.summary.toLowerCase(), updated);
        } else {
          const row = db
            .insert(painPoints)
            .values({
              summary: p.summary,
              sector: p.sector,
              intensity: 1,
              evidence: JSON.stringify(evidence),
              lastSeenAt: new Date(),
              createdAt: new Date(),
            })
            .returning()
            .get();
          byNorm.set(p.summary.toLowerCase(), row);
        }
        painCount++;
      }
    } catch (e) {
      console.error('[pain] extraction batch failed:', e);
    }
  }

  // Exit / revenue comps from money-mentioning curated stories
  let compCount = 0;
  const moneyRegex = /\$\s?[\d,.]+|acquir|sold for|\bMRR\b|\bARR\b|revenue/i;
  const candidates = db
    .select()
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gte(stories.createdAt, dayAgo)))
    .all()
    .filter((s) => moneyRegex.test(`${s.title} ${s.tldr ?? ''}`))
    .slice(0, COMP_CAP);
  if (candidates.length > 0) {
    const system =
      'Extract concrete money comparables for small software products from these stories: ' +
      'acquisitions/sales ("exit") and revenue reports ("revenue"). Only include entries with a ' +
      'specific product and, when stated, a USD amount (convert "$5k MRR" → 5000, kind "revenue"; ' +
      '"sold for $120k" → 120000, kind "exit"). Skip big-corp M&A above $100M — Runelabs builds ' +
      'small products.\n' +
      'Respond with STRICT JSON only: {"comps":[{"kind":"exit|revenue","product":"...","amountUsd":123,"note":"..."}]}';
    const user = candidates.map((s) => `- ${s.title}${s.tldr ? ` — ${s.tldr}` : ''}`).join('\n');
    try {
      const res = await chatJSON<{ comps?: unknown }>(system, user);
      const existing = db
        .select()
        .from(comps)
        .where(gte(comps.createdAt, new Date(Date.now() - 7 * 864e5)))
        .all();
      const seen = new Set(existing.map((c) => `${c.kind}|${c.product.toLowerCase()}|${c.amountUsd ?? ''}`));
      for (const c of sanitizeComps(res.comps)) {
        const key = `${c.kind}|${c.product.toLowerCase()}|${c.amountUsd ?? ''}`;
        if (seen.has(key)) continue; // re-runs and re-reported stories don't duplicate
        seen.add(key);
        db.insert(comps)
          .values({ ...c, sourceUrl: null, createdAt: new Date() })
          .run();
        compCount++;
      }
    } catch (e) {
      console.error('[pain] comps extraction failed:', e);
    }
  }

  return { pains: painCount, comps: compCount };
}
