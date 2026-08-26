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

function formatRejectSummary(rejects: { slug: string; reason: string }[]): string {
  const counts = new Map<string, number>();
  for (const r of rejects) {
    counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, n]) => (n > 1 ? `${reason} x${n}` : reason))
    .join(', ');
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
    `You score composed openings for ${identity.productName}. You are given candidate ` +
    `angles that were composed mechanically from live market signal, and the evidence they ` +
    `were composed from. Your job is to judge each one honestly and score it.\n\n` +
    `Rules:\n` +
    `- Put every scored candidate in the JSON array under the key "openings". Do not wrap ` +
    `the array under any other key.\n` +
    `- Keep each candidate's slug EXACTLY as given.\n` +
    `- Rewrite title and thesis into something a builder would actually recognise as a business.\n` +
    `- Drop any candidate that is incoherent or has no real demand behind it. Returning fewer ` +
    `openings than you were given is correct and expected.\n` +
    `- evidenceRefs must only cite refs from the evidence block.\n` +
    `- subScores: every key 0-20, honest, not uniformly generous.\n` +
    `- kpis: concrete numbers or null. Never invent precision you do not have.\n\n` +
    `Reply with JSON: {"openings":[{"slug","title","thesis","sector","window","windowMonths",` +
    `"subScores":{...},"kpis":{...},"evidenceRefs":[...]}]}`;

  const user =
    `<evidence>\n${evidence}\n</evidence>\n\n` +
    `<candidates>\n${leadBlock}\n</candidates>` +
    (constraints ? `\n\n${renderConstraints(constraints)}` : '');

  let raw: unknown;
  try {
    raw = await chatJSON<unknown>(system, user, {
      feature: 'lead_refine',
      userId,
      maxTokens: 4000,
    });
  } catch {
    return { drafts: [], rejects: [] };
  }

  const { payload, usedKey } = extractOpeningsPayload(raw);
  const rejects: { slug: string; reason: string }[] = [];
  const sanitized = sanitizeOpportunities(payload, validRefs, rejects);
  const candidateSlugs = new Set(leads.map((l) => normalizeSlug(l.slug)));
  const drafts: OppDraft[] = [];
  for (const d of sanitized) {
    if (!candidateSlugs.has(d.slug)) {
      rejects.push({ slug: d.slug, reason: 'slug-not-in-candidates' });
      continue;
    }
    drafts.push(d);
  }
  if (drafts.length === 0) {
    console.warn(
      `[refine] 0 drafts from ${leads.length} candidates; used=${usedKey}; keys=${JSON.stringify(Object.keys((raw ?? {}) as object))} ` +
        `raw=${JSON.stringify(raw ?? {}).slice(0, 400)}`,
    );
    if (rejects.length > 0) {
      console.warn(`[refine] ${leads.length} candidates in, 0 out — ${formatRejectSummary(rejects)}`);
    }
  }
  return { drafts, rejects };
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
