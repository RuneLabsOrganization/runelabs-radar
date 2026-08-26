/**
 * The wedge taxonomy — the four axes Rung-0 composition crosses against
 * intelligence primitives, plus the compatibility rules that keep the
 * cross-product coherent.
 *
 * Rows live in the database (admin-editable); DEFAULT_WEDGES below is the
 * shipped starting set, installed idempotently by seedWedges().
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { wedgeValues } from '../db/schema';

export const WEDGE_AXES = ['business_model', 'delivery_form', 'buyer', 'moat_play'] as const;
export type WedgeAxis = (typeof WEDGE_AXES)[number];

export interface WedgeValue {
  id: number;
  axis: WedgeAxis;
  slug: string;
  label: string;
  requiresTags: string[];
  excludesTags: string[];
  weight: number;
}

/** One point in wedge space: exactly one value per axis. */
export type Wedge = Record<WedgeAxis, WedgeValue>;

interface WedgeSeed {
  axis: WedgeAxis;
  slug: string;
  label: string;
  requiresTags?: string[];
  excludesTags?: string[];
  weight?: number;
}

/**
 * Shipped taxonomy. Tags are matched against primitive tags derived in
 * primitives.ts — keep the vocabularies in sync when editing either file.
 * Current tag vocabulary: agentic, consumer, regulated, infra, creative,
 * data, devtools, commerce, enterprise, general.
 */
export const DEFAULT_WEDGES: WedgeSeed[] = [
  // --- how it makes money ---
  { axis: 'business_model', slug: 'subscription-saas', label: 'monthly subscription', weight: 12 },
  { axis: 'business_model', slug: 'usage-api', label: 'metered API', requiresTags: ['infra'], weight: 14 },
  { axis: 'business_model', slug: 'marketplace-take-rate', label: 'marketplace take-rate', excludesTags: ['infra'], weight: 8 },
  { axis: 'business_model', slug: 'one-off-tool', label: 'one-off paid tool', weight: 9 },
  { axis: 'business_model', slug: 'done-for-you-service', label: 'productized service', weight: 11 },
  { axis: 'business_model', slug: 'data-subscription', label: 'data feed subscription', requiresTags: ['data'], weight: 13 },

  // --- what the buyer actually touches ---
  { axis: 'delivery_form', slug: 'hosted-dashboard', label: 'hosted dashboard', weight: 10 },
  { axis: 'delivery_form', slug: 'cli-tool', label: 'CLI tool', requiresTags: ['devtools'], excludesTags: ['consumer'], weight: 12 },
  { axis: 'delivery_form', slug: 'api-endpoint', label: 'API endpoint', requiresTags: ['infra'], weight: 13 },
  { axis: 'delivery_form', slug: 'browser-extension', label: 'browser extension', excludesTags: ['infra'], weight: 9 },
  { axis: 'delivery_form', slug: 'mcp-server', label: 'MCP server', requiresTags: ['agentic'], weight: 15 },
  { axis: 'delivery_form', slug: 'batch-report', label: 'recurring batch report', requiresTags: ['data'], weight: 10 },

  // --- who pays ---
  { axis: 'buyer', slug: 'solo-builder', label: 'solo builders', excludesTags: ['enterprise'], weight: 10 },
  { axis: 'buyer', slug: 'small-agency', label: 'small agencies', weight: 12 },
  { axis: 'buyer', slug: 'mid-market-ops', label: 'mid-market ops teams', weight: 13 },
  { axis: 'buyer', slug: 'enterprise-platform-team', label: 'enterprise platform teams', excludesTags: ['consumer'], weight: 11 },
  { axis: 'buyer', slug: 'creator', label: 'creators', requiresTags: ['creative'], weight: 9 },
  { axis: 'buyer', slug: 'ecommerce-seller', label: 'ecommerce sellers', requiresTags: ['commerce'], weight: 11 },

  // --- why it survives contact with a competitor ---
  { axis: 'moat_play', slug: 'proprietary-dataset', label: 'proprietary dataset', requiresTags: ['data'], weight: 15 },
  { axis: 'moat_play', slug: 'workflow-lock-in', label: 'workflow lock-in', weight: 12 },
  { axis: 'moat_play', slug: 'distribution-channel', label: 'owned distribution channel', weight: 13 },
  { axis: 'moat_play', slug: 'speed-to-market', label: 'speed to market', weight: 8 },
  { axis: 'moat_play', slug: 'compliance-cert', label: 'compliance certification', requiresTags: ['regulated'], weight: 14 },
  { axis: 'moat_play', slug: 'community', label: 'community moat', excludesTags: ['enterprise'], weight: 10 },
];

/** Install the shipped taxonomy. Idempotent: existing rows are left alone. */
export function seedWedges(): number {
  const db = getDb();
  let inserted = 0;
  for (const w of DEFAULT_WEDGES) {
    const prior = db
      .select({ id: wedgeValues.id })
      .from(wedgeValues)
      .where(and(eq(wedgeValues.axis, w.axis), eq(wedgeValues.slug, w.slug)))
      .get();
    if (prior) continue;
    db.insert(wedgeValues)
      .values({
        axis: w.axis,
        slug: w.slug,
        label: w.label,
        requiresTags: JSON.stringify(w.requiresTags ?? []),
        excludesTags: JSON.stringify(w.excludesTags ?? []),
        weight: w.weight ?? 10,
      })
      .run();
    inserted += 1;
  }
  return inserted;
}

/** Active taxonomy values grouped by axis, in stable id order. */
export type WedgeSpace = Record<WedgeAxis, WedgeValue[]>;

function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** Load the active taxonomy, grouped by axis. */
export function loadWedges(): WedgeSpace {
  const rows = getDb()
    .select()
    .from(wedgeValues)
    .where(eq(wedgeValues.active, true))
    .orderBy(wedgeValues.id)
    .all();
  const space = { business_model: [], delivery_form: [], buyer: [], moat_play: [] } as WedgeSpace;
  for (const r of rows) {
    if (!(WEDGE_AXES as readonly string[]).includes(r.axis)) continue;
    space[r.axis as WedgeAxis].push({
      id: r.id,
      axis: r.axis as WedgeAxis,
      slug: r.slug,
      label: r.label,
      requiresTags: parseTags(r.requiresTags),
      excludesTags: parseTags(r.excludesTags),
      weight: r.weight,
    });
  }
  return space;
}

/** Total number of distinct wedges — the size of the axis cross-product. */
export function wedgeSpaceSize(space: WedgeSpace): number {
  return WEDGE_AXES.reduce((n, axis) => n * space[axis].length, 1);
}

/**
 * Mixed-radix decode: index → exactly one wedge. Bijective over
 * [0, wedgeSpaceSize), which is what lets composition enumerate the space by
 * integer without materialising it.
 */
export function wedgeAt(space: WedgeSpace, index: number): Wedge {
  let rest = index;
  const out = {} as Wedge;
  for (const axis of WEDGE_AXES) {
    const values = space[axis];
    out[axis] = values[rest % values.length];
    rest = Math.floor(rest / values.length);
  }
  return out;
}

/**
 * Does this wedge value make sense for a primitive carrying these tags?
 * All requiresTags must be present; any excludesTag disqualifies. Excludes are
 * checked first so a contradictory rule fails closed.
 */
export function isCompatible(value: WedgeValue, primitiveTags: string[]): boolean {
  const tags = new Set(primitiveTags);
  if (value.excludesTags.some((t) => tags.has(t))) return false;
  return value.requiresTags.every((t) => tags.has(t));
}

/** True when every axis of the wedge is compatible with the primitive. */
export function wedgeCompatible(wedge: Wedge, primitiveTags: string[]): boolean {
  return WEDGE_AXES.every((axis) => isCompatible(wedge[axis], primitiveTags));
}
