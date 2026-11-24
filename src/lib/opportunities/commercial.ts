import { z } from 'zod';
import { safePublicHttpUrl } from '../safe-url';

/** Client-safe wire format inside opportunities.kpis. Monetary estimates are USD. */
export const businessModels = ['B2B', 'B2C', 'B2B2C', 'marketplace', 'prosumer', 'other'] as const;
const line = z.string().trim().min(1).max(600);
const finite = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ids = z.array(z.string().regex(/^[A-Z]\d+$/)).min(1).max(12);
const scenario = (n: z.ZodNumber) =>
  z.object({ low: n, base: n, high: n }).refine(s => s.low <= s.base && s.base <= s.high);

export function commercialUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048 || !/^https?:\/\/[^\s\\]+$/i.test(raw)) return null;
  const safe = safePublicHttpUrl(raw);
  if (!safe) return null;
  const u = new URL(safe);
  const domain = /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+(?:[a-z]{2,63}|xn--[a-z\d-]{2,59})$/i;
  if (u.username || u.password || !domain.test(u.hostname) ||
      /\.(?:local|internal|localhost|test|invalid)$/i.test(u.hostname) ||
      [...u.searchParams.keys()].some(k => /^(?:token|api[_-]?key|access[_-]?token|signature|x-amz-signature)$/i.test(k))) return null;
  u.hash = '';
  return u.href;
}

const source = z.object({
  id: z.string().regex(/^[A-Z]\d+$/),
  url: z.string().refine(u => commercialUrl(u) !== null),
  title: line,
  snippet: line,
  publishedAt: z.string().datetime().nullable(),
});

export const aiUsage = z.object({
  task: line,
  inputTokens: finite.int().positive().max(10_000_000),
  outputTokens: finite.int().positive().max(1_000_000),
  attemptsPerTask: finite.min(1).max(100),
  tasksPerCustomerMonth: finite.positive().max(10_000_000),
});

const commercial = z.object({
  geography: line,
  businessModel: z.enum(businessModels),
  user: line.optional(),
  payer: line.optional(),
  industry: line.optional(),
  researchedAt: z.string().datetime(),
  sources: z.array(source).min(1).max(24),
  marketReference: z.object({ population: finite.int().positive(), unit: line, period: line, sourceIds: ids }).optional(),
  sectorSpending: z.object({ usd: finite.positive(), category: line, period: line, sourceIds: ids }).optional(),
  competition: z.array(z.object({
    name: line, offering: line, sourceIds: ids,
    availability: z.enum(['confirmed', 'unconfirmed']).optional(), // absent on legacy profiles
  })).min(1).max(5).optional(),
  market: z.object({ buyer: line, buyerCounts: scenario(finite.int()), assumptions: line, sourceIds: ids }).optional(),
  cacReferences: z.array(z.object({
    publisher: line, geography: line, scope: z.enum(['matched', 'external']), cohort: line, period: line, channel: line, methodology: line,
    unit: z.enum(['click', 'lead', 'paying customer']), usd: finite.positive(), sourceIds: ids,
  })).min(1).max(6).optional(),
  cac: z.object({
    kind: z.enum(['observed', 'scenario']).optional(), // Older estimates lacked a discriminator.
    channel: line, usd: scenario(finite), assumptions: line, sourceIds: ids,
  }).optional(),
  execution: z.object({
    pilotDays: finite.int().min(1).max(365),
    assumptions: line,
    ai: aiUsage.extend({
      model: line, inputUsdPerMillion: finite, outputUsdPerMillion: finite,
      costPerTaskUsd: finite, sourceIds: ids,
    }).optional(),
  }).optional(),
});

export type CommercialProfile = z.infer<typeof commercial>;
export type CommercialSource = z.infer<typeof source>;

const audience = z.object({
  businessModel: z.enum([...businessModels, 'unknown']),
  user: line,
  payer: line,
  industry: line,
});
export type OpportunityAudience = z.infer<typeof audience>;
export function parseAudience(value: unknown): OpportunityAudience | undefined {
  const parsed = audience.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const priceBasis = z.object({
  kind: z.enum(['direct', 'commission', 'advertising']),
  usdPerEvent: finite.positive(),
  eventsPerPayerMonth: finite.positive(),
  takeRate: z.number().finite().positive().max(1).optional(),
  payer: line,
  assumptions: line,
}).refine(b => b.kind === 'commission' ? b.takeRate !== undefined : b.takeRate === undefined);

/** Commission events carry GMV before takeRate. Other events carry product revenue. */
export type PriceBasis = z.infer<typeof priceBasis>;

export function parsePriceBasis(value: unknown): PriceBasis | undefined {
  const parsed = priceBasis.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function parseCommercial(value: unknown): CommercialProfile | null {
  const parsed = commercial.safeParse(value);
  if (!parsed.success) return null;
  const p = parsed.data;
  const known = new Set(p.sources.map(s => s.id));
  if (known.size !== p.sources.length || new Set(p.sources.map(s => commercialUrl(s.url))).size !== known.size) return null;
  const claims = [...(p.competition ?? []), p.marketReference, p.sectorSpending, p.market, ...(p.cacReferences ?? []), p.cac, p.execution?.ai].filter(c => c !== undefined);
  if (!claims.length || claims.some(c => c.sourceIds.some(id => !known.has(id)))) return null;
  const cac = p.cac;
  if (cac?.kind === 'observed' && !p.cacReferences?.some(r => r.scope === 'matched' && r.unit === 'paying customer' &&
      r.sourceIds.some(id => cac.sourceIds.includes(id)) && r.usd === cac.usd.low &&
      r.usd === cac.usd.base && r.usd === cac.usd.high)) return null;
  return p;
}
