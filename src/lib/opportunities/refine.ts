/**
 * Rung 1 — one metered LLM call turns composed leads into scored opportunity
 * drafts.
 *
 * The prompt is seeded from THIS caller's leads, which came from THIS caller's
 * slice of the composition space. That is what breaks the convergence the old
 * scout suffered: engine.ts's buildContext() handed every caller an identical
 * block, so the model proposed identical openings.
 *
 * Output goes through the same sanitizeOpportunities() the daily engine uses,
 * so a hallucinated evidence ref or an out-of-range score is dropped here
 * rather than persisted.
 */
import { getIdentity } from '../identity';
import { chatJSON } from '../llm/minimax';
import { promptLine } from '../prompt-hygiene';
import { sanitizeOpportunities, type OppDraft, type ScoutConstraints } from './engine';
import type { LeadRow } from './leads';
import type { Primitive } from './primitives';
import { normalizeSlug } from './slug';

export interface RefineOptions {
  leads: LeadRow[];
  primitives: Primitive[];
  constraints?: ScoutConstraints;
  userId: number | null;
}

function renderConstraints(c: ScoutConstraints): string {
  const lines = [
    c.skills ? `skills: ${promptLine(c.skills, 200)}` : null,
    c.capital ? `capital: ${promptLine(c.capital, 80)}` : null,
    c.hoursPerWeek !== undefined
      ? `hours per week: ${Math.max(0, Math.min(80, Math.round(c.hoursPerWeek)))}`
      : null,
    c.sector ? `sector focus: ${promptLine(c.sector, 60)}` : null,
    c.b2b !== undefined ? `market: ${c.b2b ? 'B2B' : 'B2C'}` : null,
    c.riskAppetite ? `risk appetite: ${c.riskAppetite}` : null,
  ].filter((l): l is string => l !== null);
  return lines.length ? `<builder-constraints>\n${lines.join('\n')}\n</builder-constraints>` : '';
}

export async function refineLeads(
  opts: RefineOptions,
): Promise<{ drafts: OppDraft[]; rejects: { slug: string; reason: string }[] }> {
  const { leads, primitives, constraints, userId } = opts;
  if (leads.length === 0) return { drafts: [], rejects: [] };

  const validRefs = new Set(primitives.map((p) => p.ref));
  const evidence = primitives
    .map((p) => `[${p.ref}] (${p.type}) ${promptLine(p.label, 200)}`)
    .join('\n');

  const leadBlock = leads
    .map(
      (l) =>
        `- slug: ${l.slug}\n  angle: ${promptLine(l.title, 120)}\n` +
        `  wedge: ${Object.entries(l.wedge).map(([k, v]) => `${k}=${v}`).join(', ')}\n` +
        `  evidence: ${l.primitiveRefs.join(', ')}`,
    )
    .join('\n');

  const identity = getIdentity();
  const system =
    `You score composed business openings for ${identity.productName}, drawn from real ` +
    `live signal (pain reports, market patterns, news) crossed against a business-model ` +
    `taxonomy. Your job is to score EVERY candidate honestly, not to decide which ones ` +
    `make the cut — a separate deterministic gate does that from your scores. A weak or ` +
    `thin candidate should score low, not be omitted.\n\n` +
    `Rules:\n` +
    `- Put ALL candidates in the JSON array under the key "openings", in the same order ` +
    `given, one entry per candidate. The array length must equal the number of candidates.\n` +
    `- Keep each candidate's slug EXACTLY as given.\n` +
    `- Rewrite title and thesis into something a builder would recognise as a real business, ` +
    `even for a weak candidate — describe what it would be, honestly, not what you wish it were.\n` +
    `- Single-source evidence (one cited ref) is NORMAL at this stage, not a reason to reject. ` +
    `Score it on its merits and let subScores/confidence reflect the thinness — do not omit it.\n` +
    `- Only omit a candidate if the input itself is unusable (empty, unintelligible, or ` +
    `not describing a business at all). This should be rare — most candidates you receive ` +
    `have a real thesis and should get a real, even if low, score.\n` +
    `- evidenceRefs must only cite refs from the evidence block.\n` +
    `- subScores: ALL TEN keys, each a bare integer 0-20 (not a string, not an ` +
    `object, not a percent) where higher is always MORE favorable: {demand, ` +
    `buildability (20 = weekend-buildable), margin, competition (20 = wide-open ` +
    `field), timing, moat (defensibility once shipped), regClear (20 = no ` +
    `regulatory exposure), platformSafe (20 = no single-platform dependency), ` +
    `distribution (20 = the ICP is cheap to reach), qualityBar (20 = sellable ` +
    `quality is easy to hit)}. Score anchors — 0-5 terrible, 6-10 weak, 11-15 ` +
    `decent, 16-20 exceptional. A thin, single-source candidate should mostly ` +
    `land 4-10 across the board — low numbers, never omitted.\n` +
    `- kpis: concrete numbers or null. Never invent precision you do not have.\n\n` +
    `Reply with JSON: {"openings":[{"slug","title","thesis","sector","window","windowMonths",` +
    `"subScores":{"demand":9,"buildability":14,"margin":8,"competition":11,` +
    `"timing":10,"moat":6,"regClear":17,"platformSafe":15,"distribution":9,` +
    `"qualityBar":13},"kpis":{...},"evidenceRefs":[...]}]}`;

  const user =
    `<evidence>\n${evidence}\n</evidence>\n\n` +
    `<candidates>\n${leadBlock}\n</candidates>` +
    (constraints ? `\n\n${renderConstraints(constraints)}` : '');

  let raw: unknown;
  try {
    raw = await chatJSON<unknown>(system, user, {
      feature: 'lead_refine',
      userId,
      maxTokens: 12000,
    });
  } catch {
    return { drafts: [], rejects: [] };
  }

  const { payload, usedKey } = extractOpeningsPayload(raw);
  const rejects: { slug: string; reason: string }[] = [];
  const sanitized = sanitizeOpportunities(payload, validRefs, rejects, Math.max(leads.length, 1));
  const candidateSlugs = new Set(leads.map((l) => normalizeSlug(l.slug)));
  const drafts: OppDraft[] = [];
  for (const d of sanitized) {
    if (!candidateSlugs.has(d.slug)) {
      rejects.push({ slug: d.slug, reason: 'slug-not-in-candidates' });
      continue;
    }
    drafts.push(d);
  }
  if (drafts.length < leads.length) {
    const head =
      `[refine] ${drafts.length} drafts from ${leads.length} candidates; used=${usedKey}; ` +
      `keys=${JSON.stringify(Object.keys((raw ?? {}) as object))}`;
    console.warn(
      drafts.length === 0 ? `${head} raw=${JSON.stringify(raw ?? {}).slice(0, 400)}` : head,
    );
    logSubScoreShape(raw, rejects);
  }
  return { drafts, rejects };
}

function pickScoreBlock(rec: Record<string, unknown>): unknown {
  for (const k of ['subScores', 'sub_scores', 'scores']) {
    if (rec[k] !== undefined) return rec[k];
  }
  for (const v of Object.values(rec)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'demand' in v) return v;
  }
  return rec;
}

function logSubScoreShape(
  raw: unknown,
  rejects: { slug: string; reason: string }[],
): void {
  const hit = rejects.find((r) => r.reason.startsWith('missing-or-invalid-sub-score'));
  if (!hit) return;
  const { payload } = extractOpeningsPayload(raw);
  const items = Array.isArray(payload) ? payload : [];
  const rec = items.find((item): item is Record<string, unknown> => {
    if (typeof item !== 'object' || item === null) return false;
    const s = (item as Record<string, unknown>).slug;
    return typeof s === 'string' && (normalizeSlug(s) === hit.slug || s === hit.slug);
  });
  const block = rec ? pickScoreBlock(rec) : undefined;
  console.warn(`[refine] sub-score shape mismatch on ${hit.slug}: subScores=${JSON.stringify(block)}`);
}

/** extractJson spans first `{` to last `}`, so a bare `[{...}]` arrives as the inner object. */
function looksLikeOpening(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const rec = v as Record<string, unknown>;
  return typeof rec.slug === 'string' && typeof rec.title === 'string' && typeof rec.thesis === 'string';
}

function extractOpeningsPayload(raw: unknown): { payload: unknown; usedKey: string } {
  if (Array.isArray(raw)) return { payload: raw, usedKey: '(array)' };
  if (raw === null || typeof raw !== 'object') return { payload: raw, usedKey: '(raw)' };
  const rec = raw as Record<string, unknown>;
  if (rec.openings !== undefined) return { payload: rec.openings, usedKey: 'openings' };
  if (rec.opportunities !== undefined) return { payload: rec.opportunities, usedKey: 'opportunities' };
  // extractJson cannot return a top-level array; a one-item payload shows up as the object itself
  if (looksLikeOpening(raw)) return { payload: [raw], usedKey: '(object)' };
  for (const k of Object.keys(rec)) {
    if (Array.isArray(rec[k])) return { payload: rec[k], usedKey: k };
  }
  return { payload: undefined, usedKey: '(none)' };
}
