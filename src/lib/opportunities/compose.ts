/**
 * Rung 0 — deterministic, zero-LLM composition.
 *
 * The candidate space is primitives x wedges. A caller walks it through their
 * own bijective permutation (seed.ts), skipping combinations whose wedge is
 * incompatible with the primitive's tags. The result is a LeadDraft: an
 * explicitly UNVALIDATED hypothesis, never a scored opportunity.
 *
 * Pure: no DB, no LLM, no clock. Everything it needs is passed in.
 */
import { normalizeSlug } from './slug';
import type { Primitive, PrimitiveType } from './primitives';
import { sliceFor } from './seed';
import { wedgeAt, wedgeCompatible, wedgeSpaceSize, WEDGE_AXES } from './wedges';
import type { Wedge, WedgeAxis, WedgeSpace } from './wedges';

export interface LeadDraft {
  slug: string;
  title: string;
  /** Honest skeleton — a shape to refine, not a claim to act on. */
  thesisSkeleton: string;
  sector: string | null;
  primitiveRefs: string[];
  /** Source primitive type — sort key for get_leads, not part of the score. */
  primitiveType: PrimitiveType;
  /** Evidence text these primitiveRefs resolved to at compose time. */
  evidenceSnapshot: { ref: string; type: string; label: string }[];
  /** axis → wedge value slug */
  wedge: Record<WedgeAxis, string>;
  /** 0..100 heuristic only. Deliberately NOT called a flip score. */
  heuristicScore: number;
  /** Position in the primitives x wedges space; lets callers verify decoding. */
  combinationIndex: number;
}

export interface ComposeResult {
  leads: LeadDraft[];
  /** Feed back as `cursor` for the next page; null when the space is exhausted. */
  nextCursor: number | null;
  spaceSize: number;
  /** Combinations examined, including those rejected — for observability. */
  scanned: number;
}

export interface ComposeOptions {
  primitives: Primitive[];
  space: WedgeSpace;
  ownerKey: string;
  day: string;
  cursor: number;
  limit: number;
  avoidSectors?: string[];
  excludeSlugs?: Set<string>;
}

/** Candidate indices requested per scan batch. */
const SCAN_WINDOW = 64;
/** Hard ceiling on work per call, so a hostile taxonomy cannot spin the CPU. */
const MAX_SCAN = 4000;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'their', 'they',
  'are', 'was', 'were', 'has', 'have', 'not', 'but', 'its', 'out', 'off',
  'cannot', 'without', 'each', 'every', 'keeps', 'keep', 'still', 'when',
]);

/** Two or three meaningful words from a primitive label — the slug/title stem. */
function keywords(label: string, count: number): string[] {
  return label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w))
    .slice(0, count);
}

/** Title-case a keyword phrase for display. */
function phrase(words: string[]): string {
  if (words.length === 0) return 'an emerging gap';
  return words.join(' ');
}

const TRAILER =
  'Composed from live signal and not yet validated — refine it to get scores and KPIs.';

/** Evidence strength by primitive type — a flat, legible ordering term. */
const TYPE_BONUS: Record<PrimitiveType, number> = {
  pain: 20,      // someone said they hurt: direct demand evidence
  pattern: 12,   // capability or timing shift: strong circumstantial
  entity: 4,
  story: 0,      // news: context only
};

function thesisSkeleton(type: PrimitiveType, label: string, wedge: Wedge): string {
  const buyer = wedge.buyer.label;
  const delivery = wedge.delivery_form.label;
  const model = wedge.business_model.label;
  const moat = wedge.moat_play.label;
  const asWedge = `as ${delivery} on a ${model}, defended by ${moat}.`;

  let body: string;
  switch (type) {
    case 'story':
    case 'entity':
      body = `${label} just became available or cheap. ${buyer} could exploit that ${asWedge}`;
      break;
    case 'pattern':
      body = `Signal: ${label} ${buyer} could act on it ${asWedge}`;
      break;
    case 'pain':
      body = `${buyer} are hit by: ${label} Deliver it ${asWedge}`;
      break;
  }
  return `${body} ${TRAILER}`;
}

export function composeLeads(opts: ComposeOptions): ComposeResult {
  const { primitives, space, ownerKey, day, cursor, limit } = opts;
  const avoid = new Set((opts.avoidSectors ?? []).map((s) => s.toLowerCase()));
  const exclude = opts.excludeSlugs ?? new Set<string>();

  const wedgeCount = wedgeSpaceSize(space);
  const spaceSize = primitives.length * wedgeCount;
  if (spaceSize === 0 || limit <= 0) {
    return { leads: [], nextCursor: null, spaceSize, scanned: 0 };
  }

  const leads: LeadDraft[] = [];
  const emitted = new Set<string>();
  let pos = Math.max(0, cursor);
  let scanned = 0;

  while (leads.length < limit && pos < spaceSize && scanned < MAX_SCAN) {
    const window = sliceFor(ownerKey, day, spaceSize, pos, SCAN_WINDOW);
    if (window.length === 0) break;

    for (const index of window) {
      pos += 1;
      scanned += 1;

      // decode: primitive varies fastest so adjacent positions differ visibly
      const primitive = primitives[index % primitives.length];
      const wedge = wedgeAt(space, Math.floor(index / primitives.length));

      if (primitive.sector && avoid.has(primitive.sector.toLowerCase())) continue;
      if (!wedgeCompatible(wedge, primitive.tags)) continue;

      const stem = keywords(primitive.label, 3);
      // Index last (readable) but reserved so the 60-char normalizeSlug cap
      // cannot drop it — otherwise paging collides on truncated suffixes.
      const unique = index.toString(36);
      const head = normalizeSlug(
        `${stem.join('-')}-${wedge.delivery_form.slug}-${wedge.buyer.slug}`,
      ).slice(0, Math.max(1, 60 - unique.length - 1));
      const slug = normalizeSlug(`${head}-${unique}`);
      if (!slug || exclude.has(slug) || emitted.has(slug)) continue;

      // intensity + wedge weight + a type bonus that dominates wedge variance
      const avgWeight =
        WEDGE_AXES.reduce((n, axis) => n + wedge[axis].weight, 0) / WEDGE_AXES.length;
      const heuristicScore = Math.max(
        0,
        Math.min(
          100,
          Math.round(primitive.intensity * 0.35 + avgWeight * 1.5 + TYPE_BONUS[primitive.type]),
        ),
      );

      emitted.add(slug);
      leads.push({
        slug,
        title: `${phrase(stem)} as ${wedge.delivery_form.label} for ${wedge.buyer.label}`,
        thesisSkeleton: thesisSkeleton(primitive.type, primitive.label, wedge),
        sector: primitive.sector,
        primitiveRefs: [primitive.ref],
        primitiveType: primitive.type,
        evidenceSnapshot: [{ ref: primitive.ref, type: primitive.type, label: primitive.label }],
        wedge: {
          business_model: wedge.business_model.slug,
          delivery_form: wedge.delivery_form.slug,
          buyer: wedge.buyer.slug,
          moat_play: wedge.moat_play.slug,
        },
        heuristicScore,
        combinationIndex: index,
      });

      if (leads.length >= limit) break;
    }
  }

  return {
    leads,
    nextCursor: pos < spaceSize ? pos : null,
    spaceSize,
    scanned,
  };
}
