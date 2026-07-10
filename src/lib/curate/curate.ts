import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { items, stories, votes } from '../db/schema';
import { chatJSON, LlmError } from '../llm/minimax';
import { DOMAINS, type Domain } from '../domains';
import { clusterNewItems } from './cluster';

/** Max 'raw' stories sent to MiniMax per run. */
const CURATE_BATCH_LIMIT = 50;
/**
 * Only stories still inside the display window get LLM budget — the feed (72h),
 * brief (24h) and board sync (7d) never read anything older, so scoring a story
 * past 72h is wasted spend (feed backfill can be years deep on first ingest).
 */
const CURATE_WINDOW_MS = 72 * 36e5;
const MAX_MEMBER_ITEMS = 5;
const MAX_CALIBRATION_VOTES = 10;
const MAX_EXCERPT_CHARS = 300;

export interface CurationStory {
  title: string;
}

export interface CurationMemberItem {
  title: string;
  excerpt: string | null;
}

export interface CurationVote {
  value: number;
  storyTitle: string;
}

interface CurationResponse {
  domain_scores?: Partial<Record<Domain, number>>;
  tldr?: string;
  why_it_matters?: string;
  entities?: unknown;
}

const ENTITY_KINDS = ['model', 'tool', 'org', 'technique'] as const;

/** Sanitizes the LLM's entities array: max 6, non-empty names, known kinds. */
export function sanitizeEntities(v: unknown): { name: string; kind: string }[] {
  if (!Array.isArray(v)) return [];
  const out: { name: string; kind: string }[] = [];
  const seen = new Set<string>();
  for (const e of v) {
    if (out.length >= 6) break;
    if (typeof e !== 'object' || e === null) continue;
    const rec = e as Record<string, unknown>;
    if (typeof rec.name !== 'string') continue;
    const name = rec.name.trim().slice(0, 80);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const kind =
      typeof rec.kind === 'string' && (ENTITY_KINDS as readonly string[]).includes(rec.kind)
        ? rec.kind
        : 'model';
    out.push({ name, kind });
  }
  return out;
}

/** Builds the system + user prompts for one story's curation call. Exported for tests. */
export function buildCurationPrompts(
  story: CurationStory,
  memberItems: CurationMemberItem[],
  recentVotes: CurationVote[],
): { system: string; user: string } {
  const system = [
    'You are the curation brain for Runelabs Radar, the internal AI-intelligence hub of',
    'Runelabs — a vibecoding startup farm that ships many small AI-powered products fast.',
    '',
    'Runelabs tracks six domains. Score how relevant and impactful the story is for each',
    'domain on a 0-100 scale:',
    '- coding: AI coding assistants, code models, agentic coding tools, developer tooling.',
    '- copy: copywriting — long-form, marketing and social text generation.',
    '- image: image generation — product shots, illustration, photoreal imagery.',
    '- video: video generation — text-to-video, image-to-video, avatars/talking heads.',
    '- ads: ads management — ad creative generation, campaign automation and optimization.',
    '- agentic: agentic tasks — browser automation, computer use, multi-step agent orchestration.',
    '',
    'Scoring rubric (per domain, integers 0-100):',
    '- 0-19: irrelevant to this domain.',
    '- 20-39: tangential; background awareness only.',
    '- 40-59: relevant; teams working in this domain should take a look.',
    '- 60-79: important; likely changes tool choice or technique in this domain.',
    '- 80-100: critical; act now (major model launch, big pricing shift, capability jump).',
    '',
    'Also write:',
    '- "tldr": a factual summary of the story in at most two short sentences.',
    '- "why_it_matters": one or two sentences on the concrete implication for Runelabs teams.',
    '- "entities": up to 6 named things the story is about, each {"name","kind"} with kind one of',
    '  "model" (AI models, e.g. "GPT-5.2"), "tool" (products/frameworks, e.g. "Claude Code"),',
    '  "org" (companies/labs), "technique" (methods, e.g. "speculative decoding").',
    '  Use short canonical names (no version suffixes like dates, no vendor prefixes unless part of the name).',
    '',
    'Recent team votes are provided as calibration: score stories resembling [UP] votes',
    'higher and stories resembling [DOWN] votes lower.',
    '',
    'Respond with STRICT JSON only — no markdown, no code fences, no commentary — exactly:',
    '{"domain_scores":{"coding":N,"copy":N,"image":N,"video":N,"ads":N,"agentic":N},"tldr":"...","why_it_matters":"...","entities":[{"name":"...","kind":"..."}]}',
    'where each N is an integer between 0 and 100.',
  ].join('\n');

  const lines: string[] = [`Story: ${story.title}`, ''];

  lines.push('Member items:');
  const shownItems = memberItems.slice(0, MAX_MEMBER_ITEMS);
  if (shownItems.length === 0) {
    lines.push('(none)');
  } else {
    for (const it of shownItems) {
      const excerpt = it.excerpt ? ` — ${it.excerpt.slice(0, MAX_EXCERPT_CHARS)}` : '';
      lines.push(`- ${it.title}${excerpt}`);
    }
  }

  lines.push('', 'Recent team votes (calibration):');
  const shownVotes = recentVotes.slice(0, MAX_CALIBRATION_VOTES);
  if (shownVotes.length === 0) {
    lines.push('(none yet)');
  } else {
    for (const v of shownVotes) {
      lines.push(`${v.value > 0 ? '[UP]' : '[DOWN]'} ${v.storyTitle}`);
    }
  }

  lines.push('', 'Score this story for all six domains and reply with the strict JSON shape.');

  return { system, user: lines.join('\n') };
}

function clampScore(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

/**
 * Curation job: clusters new items into stories, then scores/summarizes up to
 * 50 of the newest 'raw' stories inside the 72h display window with one MiniMax
 * call each. LLM failures leave the story 'raw' (still visible in the feed);
 * a non-retryable error (daily cap, missing config) aborts the remaining batch.
 */
export async function runCurate(): Promise<{ clustered: number; curated: number; failed: number }> {
  const { newStories, merged } = await clusterNewItems();
  const clustered = newStories + merged;
  const db = getDb();

  const rawStories = db
    .select()
    .from(stories)
    .where(
      and(eq(stories.status, 'raw'), gte(stories.createdAt, new Date(Date.now() - CURATE_WINDOW_MS))),
    )
    .orderBy(desc(stories.createdAt), desc(stories.id))
    .limit(CURATE_BATCH_LIMIT)
    .all();

  const recentVotes: CurationVote[] = db
    .select({ value: votes.value, storyTitle: stories.title })
    .from(votes)
    .innerJoin(stories, eq(votes.storyId, stories.id))
    .orderBy(desc(sql`${votes}.rowid`))
    .limit(MAX_CALIBRATION_VOTES)
    .all();

  let curated = 0;
  let failed = 0;

  for (const story of rawStories) {
    const memberItems: CurationMemberItem[] = db
      .select({ title: items.title, excerpt: items.excerpt })
      .from(items)
      .where(eq(items.storyId, story.id))
      .orderBy(asc(items.id))
      .limit(MAX_MEMBER_ITEMS)
      .all();

    const { system, user } = buildCurationPrompts(story, memberItems, recentVotes);

    try {
      const res = await chatJSON<CurationResponse>(system, user);
      const scores = {} as Record<Domain, number>;
      for (const d of DOMAINS) {
        scores[d] = clampScore(res.domain_scores?.[d]);
      }
      const topScore = Math.max(...DOMAINS.map((d) => scores[d]));
      const entities = sanitizeEntities(res.entities);
      db.update(stories)
        .set({
          domainScores: JSON.stringify(scores),
          tldr: typeof res.tldr === 'string' ? res.tldr : null,
          whyItMatters: typeof res.why_it_matters === 'string' ? res.why_it_matters : null,
          entities: entities.length > 0 ? JSON.stringify(entities) : null,
          topScore,
          status: 'curated',
        })
        .where(eq(stories.id, story.id))
        .run();
      curated++;
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      failed++;
      if (!e.retryable) break; // daily cap / config error — no point continuing this batch
    }
  }

  return { clustered, curated, failed };
}
