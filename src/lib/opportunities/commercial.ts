import { z } from 'zod';
import { safePublicHttpUrl } from '../safe-url';

/** Client-safe wire format inside opportunities.kpis. Monetary estimates are USD. */
export const businessModels = ['B2B', 'B2C', 'B2B2C', 'marketplace', 'prosumer', 'other'] as const;
const line = z.string().trim().min(1).max(600);
const finite = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ids = z.array(z.string().regex(/^[A-Z]\d+$/)).min(1).max(40);
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
  comparableEvidence: z.object({ snippet: line, publishedAt: z.string().datetime().nullable() }).optional(),
});

export const aiUsage = z.object({
  task: line,
  inputTokens: finite.int().positive().max(10_000_000),
  outputTokens: finite.int().positive().max(1_000_000),
  attemptsPerTask: finite.min(1).max(100),
  tasksPerCustomerMonth: finite.positive().max(10_000_000),
});

const channelScenario = z.object({
  channel: line, usd: scenario(finite.positive()), cashUsd: scenario(finite).optional(), assumptions: line, sourceIds: ids,
}).refine(c => !c.cashUsd || (c.cashUsd.low <= c.usd.low && c.cashUsd.base <= c.usd.base && c.cashUsd.high <= c.usd.high));
const percent = z.number().min(0).max(100).refine(p => p === Math.round(p * 100) / 100);
const mixWeight = z.object({ channel: line, favorable: percent, base: percent, adverse: percent });
export const blendedChannel = 'Blended CAC';

/** Weights count mutually exclusive first paying customers, not dollars spent. */
export function weightedChannelCac(channels: z.infer<typeof channelScenario>[], weights: z.infer<typeof mixWeight>[],
  field: 'usd' | 'cashUsd' = 'usd', customers = 1) {
  if (weights.length < 2 || weights.length !== channels.length) return null;
  const byChannel = new Map(channels.map(c => [c.channel, c[field]]));
  if (new Set(weights.map(w => w.channel)).size !== weights.length || weights.some(w => !byChannel.get(w.channel))) return null;
  const usd = { low: 0, base: 0, high: 0 };
  for (const [cost, share] of [['low', 'favorable'], ['base', 'base'], ['high', 'adverse']] as const) {
    if (weights.reduce((sum, w) => sum + Math.round(w[share] * 100), 0) !== 10_000) return null;
    const total = weights.reduce((sum, w) => sum + Math.round(byChannel.get(w.channel)![cost] * 100) * Math.round(w[share] * 100), 0);
    usd[cost] = Math.round(total * customers / 10_000) / 100;
  }
  return usd.low <= usd.base && usd.base <= usd.high ? usd : null;
}

const commercial = z.object({
  geography: line,
  businessModel: z.enum(businessModels),
  user: line.optional(),
  payer: line.optional(),
  industry: line.optional(),
  researchedAt: z.string().datetime(),
  sources: z.array(source).min(1).max(40),
  marketReference: z.object({ population: finite.int().positive(), unit: line, period: line, sourceIds: ids }).optional(),
  sectorSpending: z.object({ usd: finite.positive(), category: line, period: line, sourceIds: ids }).optional(),
  competition: z.array(z.object({
    name: line, offering: line, sourceIds: ids,
    availability: z.enum(['confirmed', 'unconfirmed']).optional(), // absent on legacy profiles
  })).min(1).max(5).optional(),
  market: z.object({
    buyer: line, buyerCounts: scenario(finite.int()), assumptions: line, sourceIds: ids,
    scope: z.literal('comparable-cohort').optional(),
  }).optional(),
  cacReferences: z.array(z.object({
    publisher: line, geography: line, scope: z.enum(['matched', 'external']), cohort: line, period: line, channel: line, methodology: line,
    unit: z.enum(['click', 'lead', 'paying customer']), usd: finite.positive(), sourceIds: ids,
  })).min(1).max(6).optional(),
  cac: z.object({
    kind: z.enum(['observed', 'scenario']).optional(), // Older estimates lacked a discriminator.
    channel: line, usd: scenario(finite), assumptions: line, sourceIds: ids,
  }).optional(),
  cacChannels: z.array(channelScenario).min(1).max(6).optional(),
  channelMix: z.object({ weights: z.array(mixWeight).min(2).max(6), usd: scenario(finite.positive()),
    assumptions: line, sourceIds: ids }).optional(),
  bootstrap: z.object({ points: finite.max(10), initialCostUsd: finite.nullable(), monthlyCostUsd: finite.nullable(),
    firstTenCashUsd: scenario(finite).optional(), launchCashUsd: scenario(finite).optional(),
    soloPilot: z.object({
      acquisitionCashUsd: z.literal(0), founderHours: finite.positive(), expectedPayers: finite,
      days: z.literal(90), assumptions: line, sourceIds: ids,
    }).optional(),
    days: finite.nullable(), daysBasis: z.enum(['paid pilot', 'MVP']).nullable(), assumptions: line,
  }).refine(b => (b.days === null) === (b.daysBasis === null)).optional(),
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
  const claims = [...(p.competition ?? []), p.marketReference, p.sectorSpending, p.market, ...(p.cacReferences ?? []), ...(p.cacChannels ?? []), p.channelMix, p.bootstrap?.soloPilot, p.cac, p.execution?.ai].filter(c => c !== undefined);
  if (!claims.length || claims.some(c => c.sourceIds.some(id => !known.has(id)))) return null;
  const cac = p.cac;
  const mix = p.channelMix;
  if (mix) {
    const usd = weightedChannelCac(p.cacChannels ?? [], mix.weights);
    if (!usd || usd.low !== mix.usd.low || usd.base !== mix.usd.base || usd.high !== mix.usd.high ||
        p.cacChannels?.some(c => c.sourceIds.some(id => !mix.sourceIds.includes(id)))) return null;
  }
  const b = p.bootstrap;
  if (b?.firstTenCashUsd || b?.launchCashUsd) {
    if (!mix || !b.firstTenCashUsd) return null;
    const cash = weightedChannelCac(p.cacChannels ?? [], mix.weights, 'cashUsd', 10);
    if (!cash) return null;
    const fixed = b.initialCostUsd !== null && b.monthlyCostUsd !== null ? b.initialCostUsd + 3 * b.monthlyCostUsd : null;
    if ((fixed !== null) !== !!b.launchCashUsd) return null;
    for (const key of ['low', 'base', 'high'] as const) {
      if (cash[key] !== b.firstTenCashUsd[key] ||
          (fixed !== null && Math.round((fixed + cash[key]) * 100) / 100 !== b.launchCashUsd?.[key])) return null;
    }
  }
  if (p.cacChannels) {
    if (!cac || new Set(p.cacChannels.map(c => c.channel.toLowerCase())).size !== p.cacChannels.length) return null;
    const primary = mix ? { ...mix, channel: blendedChannel } : p.cacChannels[0];
    if (cac.kind !== 'observed' && (cac.kind !== 'scenario' || cac.channel !== primary.channel ||
        cac.usd.low !== primary.usd.low || cac.usd.base !== primary.usd.base || cac.usd.high !== primary.usd.high ||
        cac.sourceIds.join(',') !== primary.sourceIds.join(','))) return null;
  }
  if (cac?.kind === 'observed' && !p.cacReferences?.some(r => r.scope === 'matched' && r.unit === 'paying customer' &&
      r.sourceIds.some(id => cac.sourceIds.includes(id)) && r.usd === cac.usd.low &&
      r.usd === cac.usd.base && r.usd === cac.usd.high)) return null;
  return p;
}
