import { z } from 'zod';
import { config } from '../config';
import { estimateCostUsd, isMeteredModel } from '../llm/pricing';
import { promptLine } from '../prompt-hygiene';
import { aiUsage, businessModels, parseCommercial, type CommercialProfile, type CommercialSource } from './commercial';

const line = z.string().trim().min(1).max(360);
const assumptions = z.union([z.string(), z.array(z.string()).min(1).max(20).transform(parts => parts.join(' '))])
  .transform(s => promptLine(s, 360)).pipe(line);
const fraction = z.number().finite().positive().max(1);
const shares = z.object({ low: fraction, base: fraction, high: fraction })
  .refine(s => s.low <= s.base && s.base <= s.high);
const basis = z.object({ sourceId: line, quote: line, assumptions });
const marketInput = basis.extend({ buyer: line, population: z.number().positive().int().safe(), eligibleShare: shares });
const cacInput = basis.extend({ channel: line, costPerContactUsd: z.number().positive().finite(), conversion: shares });
const vendor = z.object({ name: line, offering: line, sourceIds: z.array(line).min(1).max(4) });
const analysis = z.object({
  businessModel: z.enum(businessModels),
  user: line.optional().catch(undefined),
  payer: line.optional().catch(undefined),
  industry: line.optional().catch(undefined),
  endUseIndustry: line.optional().catch(undefined),
  competition: z.array(z.unknown()).max(5).optional().catch(undefined),
  market: marketInput.optional().catch(undefined),
  cac: cacInput.optional().catch(undefined),
  execution: z.object({ pilotDays: z.number().int().min(1).max(365), assumptions,
    ai: aiUsage.optional().catch(undefined) }).optional().catch(undefined),
});

export function priceReference(): CommercialSource | null {
  // Same documented per-token tariff used by the job's usage meter. It is a
  // pilot assumption for language tasks; image/video/API units need their own tariff.
  const model = config.minimaxModel;
  if (!isMeteredModel(model) || !model.startsWith('MiniMax-')) return null;
  const input = estimateCostUsd(model, 1e6, 0);
  const output = estimateCostUsd(model, 0, 1e6);
  return {
    id: 'P1', url: 'https://platform.minimax.io/docs/pricing/overview', title: model + ' token pricing',
    snippet: model + ' configured tariff, USD per million tokens: input ' + input + ', output ' + output + '.',
    publishedAt: null,
  };
}

function words(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function local(text: string, geography: string) {
  if (/^(?:united states(?: of america)?|u\.?s\.?a?\.?)$/i.test(geography)) {
    return /\bUnited States\b/i.test(text) || /\b(?:USA|US|U\.S\.(?:A\.)?)(?![\w$])/.test(text);
  }
  return (' ' + words(text) + ' ').includes(' ' + words(geography) + ' ');
}

// The model selects a verbatim, geographically scoped observation. Only the
// eligibility/conversion fractions are allowed to be invented assumptions.
function observation(sources: CommercialSource[], claim: z.infer<typeof basis>, geography: string) {
  const s = sources.find(s => s.id === claim.sourceId);
  if (!s || !s.snippet.includes(claim.quote) || !local(claim.quote, geography) ||
      /\b(?:worldwide|global(?:ly)?)\b/i.test(claim.quote)) return null;
  const host = new URL(s.url).hostname;
  if (/(?:^|\.)(?:reddit\.com|facebook\.com|instagram\.com|linkedin\.com|x\.com|twitter\.com|threads\.(?:net|com)|tiktok\.com|youtube\.com|youtu\.be|quora\.com|pinterest\.com)$/i.test(host)) return null;
  return s;
}

function hasCount(quote: string, value: number) {
  for (const match of quote.matchAll(/(?<![\w.,])(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|[kmb]\b)?/gi)) {
    const before = quote.slice(0, match.index).trimEnd();
    const after = quote.slice(match.index! + match[0].length).trimStart();
    if (/(?:[$€£¥]|\b(?:USD|CAD|AUD|BRL|GBP|EUR))$/.test(before) ||
        /^(?:%|dollars?\b|USD\b|euros?\b|percent\b)/i.test(after) ||
        (value >= 1900 && value <= 2100 && /\b(?:in|during|since|for|of|year|from|through)$/i.test(before))) continue;
    const scale = match[2]?.[0]?.toLowerCase();
    const multiplier = scale === 'b' ? 1e9 : scale === 'm' ? 1e6 : scale === 't' || scale === 'k' ? 1e3 : 1;
    if (Number(match[1].replace(/,/g, '')) * multiplier === value) return true;
  }
  return false;
}

function vendorSource(s: CommercialSource, name: string, geography: string) {
  const url = new URL(s.url);
  const host = url.hostname.toLowerCase();
  const content = s.title + ' ' + s.snippet;
  if (!(' ' + words(content) + ' ').includes(' ' + words(name) + ' ')) return false;
  const brand = words(name).replace(/ /g, '');
  const parts = host.split('.');
  const compoundSuffix = /\.(?:co|com|org|net)\.[a-z]{2}$/.test(host);
  const publisher = parts.at(compoundSuffix ? -3 : -2);
  const official = publisher === brand || publisher === words(name).split(' ')[0];
  const listing = ['apps.shopify.com', 'apps.apple.com', 'play.google.com', 'marketplace.microsoft.com',
    'aws.amazon.com', 'www.g2.com', 'www.capterra.com'].includes(host);
  const country = host === 'apps.apple.com' ? url.pathname.split('/')[1] :
    host === 'play.google.com' ? url.searchParams.get('gl') : undefined;
  const storefront = country && /^[a-z]{2}$/i.test(country)
    ? new Intl.DisplayNames(['en'], {type: 'region'}).of(country.toUpperCase()) : undefined;
  return (official || listing) && (local(content, geography) || /\b(?:worldwide|available globally)\b/i.test(content) ||
    !!(storefront && local(storefront, geography)));
}

function rounded(n: number) { return Number(n.toPrecision(12)); }

export function buildCommercial(
  raw: unknown, sources: CommercialSource[], geography: string, researchedAt: string,
): CommercialProfile | null {
  const parsed = analysis.safeParse(raw);
  if (!parsed.success || sources.length === 0) return null;
  const { businessModel, user, payer, industry, market, cac, execution } = parsed.data;
  const p: CommercialProfile = { geography, businessModel, user, payer, industry: industry ?? parsed.data.endUseIndustry, researchedAt, sources: [] };
  const cited = new Set<string>();

  for (const item of parsed.data.competition ?? []) {
    const result = vendor.safeParse(item);
    if (!result.success) continue;
    const { name, offering, sourceIds } = result.data;
    const verified = sources.filter(s => sourceIds.includes(s.id) && vendorSource(s, name, geography));
    if (verified.length && !p.competition?.some(c => words(c.name) === words(name))) {
      (p.competition ??= []).push({ name, offering, sourceIds: verified.map(s => s.id) });
      verified.forEach(s => cited.add(s.id));
    }
  }
  if (market && observation(sources, market, geography) && hasCount(market.quote, market.population)) {
    const { population, eligibleShare: f } = market;
    const count = (share: number) => Math.round(population * share);
    p.market = {
      buyer: market.buyer, buyerCounts: { low: count(f.low), base: count(f.base), high: count(f.high) },
      assumptions: population + ' observed × assumed eligible shares ' + [f.low, f.base, f.high].join('/') + '. ' + market.assumptions,
      sourceIds: [market.sourceId],
    };
    cited.add(market.sourceId);
  }
  if (cac && observation(sources, cac, geography) &&
      /\b(?:click|lead|contact|CPC|CPL)\b/i.test(cac.quote)) {
    const { costPerContactUsd: cost, conversion: f } = cac;
    // A bare $ elsewhere may denote CAD, AUD, etc. Tie the actual amount to USD.
    const usd = [...cac.quote.matchAll(/(?:USD\s*\$?|US\$|\$)\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*USD\b/gi)]
      .some(m => (m[0][0] !== '$' || local(geography, 'United States')) &&
        Number((m[1] ?? m[2]).replace(/,/g, '')) === cost);
    if (usd) {
      p.cac = {
        channel: cac.channel, usd: { low: rounded(cost / f.high), base: rounded(cost / f.base), high: rounded(cost / f.low) },
        assumptions: 'USD ' + cost + '/contact ÷ assumed paying conversion ' + [f.high, f.base, f.low].join('/') + '. ' + cac.assumptions,
        sourceIds: [cac.sourceId],
      };
      cited.add(cac.sourceId);
    }
  }
  p.sources = sources.filter(s => cited.has(s.id));
  if (execution) {
    p.execution = { pilotDays: execution.pilotDays, assumptions: execution.assumptions };
    const rate = priceReference();
    if (rate && execution.ai) {
      const model = config.minimaxModel;
      const { inputTokens, outputTokens, attemptsPerTask } = execution.ai;
      p.execution.ai = {
        ...execution.ai, model, inputUsdPerMillion: estimateCostUsd(model, 1e6, 0),
        outputUsdPerMillion: estimateCostUsd(model, 0, 1e6),
        costPerTaskUsd: rounded(estimateCostUsd(model, inputTokens, outputTokens) * attemptsPerTask),
        sourceIds: [rate.id],
      };
      p.sources.push(rate);
    }
  }
  return parseCommercial(p);
}
