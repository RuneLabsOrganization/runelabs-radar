/**
 * Intelligence primitives for Rung-0 composition: the raw "something is
 * happening here" units that get crossed against the wedge taxonomy.
 *
 * Deliberately wider than engine.ts's buildContext() (12 pains / 8 patterns /
 * 10 stories) on the demand side. Breadth comes from the wedge combinatorics,
 * so stories/entities are capped at half the demand set — otherwise the
 * permutation walk is proportional to a news-heavy pool.
 */
import { and, desc, eq, gte } from 'drizzle-orm';
import { latestPatterns, topEntities } from '../analytics';
import { getDb } from '../db';
import { painPoints, stories } from '../db/schema';
import { promptLine } from '../prompt-hygiene';

export type PrimitiveType = 'pain' | 'pattern' | 'entity' | 'story';

export interface Primitive {
  /** Stable evidence ref within one load: P1, A2, E3, S4 */
  ref: string;
  type: PrimitiveType;
  label: string;
  sector: string | null;
  tags: string[];
  /** 0..100 — how loudly the stream is signalling this */
  intensity: number;
}

/** Keyword → tag. Kept in sync with the tag vocabulary used in wedges.ts. */
const TAG_LEXICON: Record<string, string[]> = {
  agentic: ['agent', 'agentic', 'mcp', 'tool call', 'tool-call', 'autonomous', 'copilot'],
  infra: ['api', 'infrastructure', 'latency', 'throughput', 'pipeline', 'deploy', 'server', 'sdk'],
  data: ['dataset', 'data', 'benchmark', 'scrape', 'index', 'embedding', 'analytics', 'telemetry'],
  regulated: ['compliance', 'soc2', 'hipaa', 'gdpr', 'audit', 'regulation', 'legal', 'privacy'],
  creative: ['image', 'video', 'design', 'render', 'creative', 'music', 'art', 'copywriting'],
  commerce: ['ecommerce', 'shopify', 'storefront', 'checkout', 'product photo', 'marketplace', 'seller'],
  devtools: ['ide', 'editor', 'lint', 'ci', 'repo', 'code review', 'debug', 'refactor', 'devtool'],
  consumer: ['consumer', 'personal', 'hobby', 'everyday', 'mobile app'],
  enterprise: ['enterprise', 'sso', 'procurement', 'on-prem', 'rbac', 'tenant'],
};

/**
 * Tags for one primitive: lexicon hits over the text, plus the sector itself.
 * Never returns empty — an untagged primitive would match only rule-free wedge
 * values and skew the space.
 */
export function deriveTags(text: string, sector: string | null): string[] {
  const hay = text.toLowerCase();
  const tags = new Set<string>();
  for (const [tag, keywords] of Object.entries(TAG_LEXICON)) {
    if (keywords.some((k) => hay.includes(k))) tags.add(tag);
  }
  if (sector) tags.add(sector.toLowerCase());
  if (tags.size === 0) tags.add('general');
  return [...tags];
}

const LOOKBACK_DAYS = 21;
const MAX_PAINS = 40;
/** Ceiling on the story candidate query — admission is capped by the context budget. */
const MAX_STORIES = 30;

/** Clamp an unbounded count into 1..100. */
function normalize(value: number, ceiling: number): number {
  return Math.max(1, Math.min(100, Math.round((value / ceiling) * 100)));
}

/** Map each type onto 0..100 using that type's own min/max. Same-value groups get 50. */
function rescaleIntensityWithinType(prims: Primitive[]): Primitive[] {
  const bounds = new Map<PrimitiveType, { min: number; max: number }>();
  for (const p of prims) {
    const cur = bounds.get(p.type);
    if (!cur) {
      bounds.set(p.type, { min: p.intensity, max: p.intensity });
    } else {
      if (p.intensity < cur.min) cur.min = p.intensity;
      if (p.intensity > cur.max) cur.max = p.intensity;
    }
  }
  return prims.map((p) => {
    const { min, max } = bounds.get(p.type)!;
    const intensity = max === min ? 50 : Math.round(((p.intensity - min) / (max - min)) * 100);
    return { ...p, intensity };
  });
}

function taggedBeyondGeneral(tags: string[]): boolean {
  return tags.some((t) => t !== 'general');
}

type ContextCandidate = Omit<Primitive, 'ref'> & { type: 'story' | 'entity' };

/** The composable primitive pool. Empty when there is no demand signal. */
export function loadPrimitives(): Primitive[] {
  const db = getDb();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5);
  const demand: Primitive[] = [];

  const pains = db
    .select()
    .from(painPoints)
    .where(gte(painPoints.lastSeenAt, since))
    .orderBy(desc(painPoints.intensity), desc(painPoints.lastSeenAt))
    .limit(MAX_PAINS)
    .all();
  pains.forEach((p, i) => {
    const label = promptLine(p.summary, 160);
    demand.push({
      ref: `P${i + 1}`,
      type: 'pain',
      label,
      sector: p.sector ?? null,
      tags: deriveTags(label, p.sector ?? null),
      intensity: normalize(p.intensity, 20),
    });
  });

  latestPatterns(15).forEach((p, i) => {
    const label = promptLine(p.headline, 160);
    demand.push({
      ref: `A${i + 1}`,
      type: 'pattern',
      label,
      sector: null,
      tags: deriveTags(label, null),
      intensity: 60,
    });
  });

  // Stories/entities are context. Their combined budget is half the demand set,
  // so pains+patterns stay a strict majority. Zero demand → empty pool, not
  // headlines crossed with business models.
  const contextBudget = Math.floor(demand.length / 2);
  if (contextBudget === 0) return rescaleIntensityWithinType(demand);

  const candidates: ContextCandidate[] = [];

  for (const e of topEntities(20)) {
    const label = `${promptLine(e.name, 60)} (${e.count} mentions)`;
    const tags = deriveTags(label, null);
    if (!taggedBeyondGeneral(tags)) continue;
    candidates.push({
      type: 'entity',
      label,
      sector: null,
      tags,
      intensity: normalize(e.count, 50),
    });
  }

  const topStories = db
    .select()
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gte(stories.createdAt, since)))
    .orderBy(desc(stories.topScore))
    .limit(MAX_STORIES)
    .all();
  for (const s of topStories) {
    const label = promptLine(s.title, 160);
    const tags = deriveTags(`${label} ${s.tldr ?? ''}`, null);
    if (!taggedBeyondGeneral(tags)) continue;
    candidates.push({
      type: 'story',
      label,
      sector: null,
      tags,
      intensity: normalize(s.topScore ?? 0, 100),
    });
  }

  candidates.sort((a, b) => b.intensity - a.intensity);
  const admitted = candidates.slice(0, contextBudget);

  let entities = 0;
  let storyCount = 0;
  const context: Primitive[] = admitted.map((c) => ({
    ...c,
    ref: c.type === 'entity' ? `E${++entities}` : `S${++storyCount}`,
  }));

  return rescaleIntensityWithinType([...demand, ...context]);
}
