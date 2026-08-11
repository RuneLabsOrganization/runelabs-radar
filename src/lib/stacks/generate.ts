import { and, desc, eq, gte } from 'drizzle-orm';
import { getDb } from '../db';
import { benchmarkSnapshots, stacks, stories } from '../db/schema';
import { aaPromptLines } from '../board/sync';
import { getIdentity } from '../identity';
import { chatJSON } from '../llm/minimax';

/** Venture archetypes Runelabs actually ships and sells. */
export const VENTURES = [
  { slug: 'saas-b2b', label: 'B2B SaaS', hint: 'multi-tenant dashboard product with subscriptions' },
  { slug: 'ai-product', label: 'AI product', hint: 'product wrapping LLM/image/video APIs with credit billing' },
  { slug: 'marketing-site', label: 'Marketing site', hint: 'high-conversion landing/marketing site with light CMS' },
  { slug: 'mobile-app', label: 'Mobile app', hint: 'cross-platform consumer mobile app' },
  { slug: 'ecommerce', label: 'E-commerce', hint: 'online store with payments and inventory' },
  { slug: 'browser-extension', label: 'Browser extension', hint: 'Chrome/Edge extension with a paid tier' },
  { slug: 'agent-service', label: 'Agent service', hint: 'productized autonomous agent doing work for clients' },
] as const;

export type VentureSlug = (typeof VENTURES)[number]['slug'];

export const STACK_LAYERS = [
  'frontend',
  'backend',
  'database',
  'auth',
  'payments',
  'hosting',
  'ai-layer',
  'analytics',
] as const;

export interface StackLayer {
  layer: string;
  pick: string;
  alt: string | null;
  note: string | null;
}

export interface StackDraft {
  title: string;
  tagline: string | null;
  layers: StackLayer[];
  costNote: string | null;
  timeToMvp: string | null;
  rationale: string | null;
}

function optStr(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null;
}

/** Validates the LLM's stack draft: title + at least 5 known layers required. */
export function sanitizeStack(v: unknown): StackDraft | null {
  if (typeof v !== 'object' || v === null) return null;
  const rec = v as Record<string, unknown>;
  const title = optStr(rec.title, 80);
  if (!title || !Array.isArray(rec.layers)) return null;
  const layers: StackLayer[] = [];
  const seen = new Set<string>();
  for (const raw of rec.layers) {
    if (typeof raw !== 'object' || raw === null) continue;
    const l = raw as Record<string, unknown>;
    const layer = typeof l.layer === 'string' ? l.layer.trim() : '';
    const pick = optStr(l.pick, 120);
    if (!pick || seen.has(layer) || !(STACK_LAYERS as readonly string[]).includes(layer)) continue;
    seen.add(layer);
    layers.push({ layer, pick, alt: optStr(l.alt, 120), note: optStr(l.note, 200) });
  }
  if (layers.length < 5) return null;
  layers.sort(
    (a, b) =>
      (STACK_LAYERS as readonly string[]).indexOf(a.layer) -
      (STACK_LAYERS as readonly string[]).indexOf(b.layer),
  );
  return {
    title,
    tagline: optStr(rec.tagline, 140),
    layers,
    costNote: optStr(rec.costNote, 200),
    timeToMvp: optStr(rec.timeToMvp, 80),
    rationale: optStr(rec.rationale, 600),
  };
}

/**
 * Weekly stack intelligence: for each venture archetype, one MiniMax call
 * recommends the ship-it-today tech stack, grounded in the week's curated
 * stories and the current AA model market. Upserts preserve team verdicts.
 */
export async function runStacks(): Promise<{ updated: number; failed: number }> {
  const db = getDb();
  const weekAgo = new Date(Date.now() - 7 * 864e5);

  const topStories = db
    .select()
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gte(stories.createdAt, weekAgo)))
    .orderBy(desc(stories.topScore))
    .limit(20)
    .all();
  const newsText =
    topStories.map((s) => `- ${s.title}${s.tldr ? ` — ${s.tldr}` : ''}`).join('\n') ||
    '(no curated stories this week)';

  const aaSnap = db
    .select()
    .from(benchmarkSnapshots)
    .where(eq(benchmarkSnapshots.source, 'artificial-analysis'))
    .orderBy(desc(benchmarkSnapshots.fetchedAt), desc(benchmarkSnapshots.id))
    .limit(1)
    .get();
  const marketText = (aaSnap && aaPromptLines(aaSnap.raw, 25)) ?? '(no model market data)';

  let updated = 0;
  let failed = 0;
  const ventures = getIdentity().ventures ?? VENTURES;
  for (const venture of ventures) {
    try {
      const existing = db.select().from(stacks).where(eq(stacks.venture, venture.slug)).get();
      const currentText = existing
        ? `Current recommendation (only change picks when the evidence justifies it):\n${existing.layers}`
        : '(no current recommendation — propose the initial stack)';

      const system =
        `You are the CTO-advisor for ${getIdentity().brandContext}. Recommend the tech stack to ship the given ` +
        `venture TODAY (${new Date().toISOString().slice(0, 10)}). Optimize for: speed to MVP ` +
        'with AI-assisted development, low monthly run cost at MVP scale, boring-but-proven ' +
        'choices over hype, and easy handover on sale. ' +
        `Cover these layers (at least 6): ${STACK_LAYERS.join(', ')}. ` +
        'For each layer give "pick" (the concrete choice), "alt" (one solid alternative), ' +
        '"note" (one line: why / cost). Also: "title" (short stack name), "tagline", ' +
        '"costNote" (expected monthly run cost at MVP scale), "timeToMvp" (honest estimate ' +
        'with AI-assisted dev), "rationale" (2-3 sentences; cite news/market data when it ' +
        'changed a pick).\n' +
        'Respond ONLY with strict JSON: {"title":"...","tagline":"...","layers":[{"layer":"...",' +
        '"pick":"...","alt":"...","note":"..."}],"costNote":"...","timeToMvp":"...","rationale":"..."}';

      const user =
        `Venture: ${venture.label} — ${venture.hint}\n\n${currentText}\n\n` +
        `This week's AI signals:\n${newsText}\n\n` +
        `Model market (Artificial Analysis):\n${marketText}`;

      const res = await chatJSON<Record<string, unknown>>(system, user);
      const draft = sanitizeStack(res);
      if (!draft) {
        failed++;
        continue;
      }
      const values = {
        title: draft.title,
        tagline: draft.tagline,
        layers: JSON.stringify(draft.layers),
        costNote: draft.costNote,
        timeToMvp: draft.timeToMvp,
        rationale: draft.rationale,
        updatedAt: new Date(),
      };
      if (existing) {
        db.update(stacks).set(values).where(eq(stacks.id, existing.id)).run();
      } else {
        db.insert(stacks).values({ venture: venture.slug, ...values }).run();
      }
      updated++;
    } catch (e) {
      console.error(`[stacks] generation failed for "${venture.slug}":`, e);
      failed++;
    }
  }
  return { updated, failed };
}
