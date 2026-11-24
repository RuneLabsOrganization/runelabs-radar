import { z } from 'zod';
import { config } from '../config';
import { estimateCostUsd, isMeteredModel } from '../llm/pricing';
import { promptLine } from '../prompt-hygiene';
import type { MarketSource } from './market-sources';
import { acquisitionReference, acquisitionGeoMatches } from './acquisition-sources';
import { aiUsage, businessModels, commercialUrl, parseCommercial, type CommercialProfile, type CommercialSource } from './commercial';

const line = z.string().trim().min(1).max(360);
const assumptions = z.union([z.string(), z.array(z.string()).min(1).max(20).transform(parts => parts.join(' '))])
  .transform(s => promptLine(s, 360)).pipe(line);
const fraction = z.number().finite().positive().max(1);
const shares = z.object({ low: fraction, base: fraction, high: fraction })
  .refine(s => s.low <= s.base && s.base <= s.high);
const basis = z.object({ sourceId: line, quote: line, assumptions });
const marketInput = basis.extend({ buyer: line, population: z.number().positive().int().safe(), eligibleShare: shares });
const selectedCac = z.object({ sourceId: line, assumptions });
const legacyCac = basis.extend({ kind: z.undefined(), channel: line, costPerContactUsd: z.number().positive().finite(), conversion: shares });
const cacInput = z.union([
  selectedCac.extend({ kind: z.literal('observed') }),
  selectedCac.extend({ kind: z.literal('scenario'), conversion: shares }),
  legacyCac,
]);
const channelObservation = z.object({
  sourceId: line, quote: line, channel: line, cohort: line, period: line, unit: z.enum(['click', 'lead', 'paying customer']),
});
const vendor = z.object({ name: line, offering: line, sourceIds: z.array(line).min(1).max(4) });
const analysis = z.object({
  businessModel: z.enum(businessModels),
  user: line.optional().catch(undefined),
  payer: line.optional().catch(undefined),
  industry: line.optional().catch(undefined),
  endUseIndustry: line.optional().catch(undefined),
  marketReferenceId: line.optional().catch(undefined),
  observedMarket: z.object({
    sourceId: line, quote: line, population: z.number().int().positive().safe(), unit: line,
    year: z.number().int().min(1900).max(2100),
  }).optional().catch(undefined),
  competition: z.array(z.unknown()).max(5).optional().catch(undefined),
  market: marketInput.optional().catch(undefined),
  cac: cacInput.optional().catch(undefined),
  acquisitionBenchmark: channelObservation.optional().catch(undefined),
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
function observation(sources: CommercialSource[], claim: { sourceId: string; quote: string }, geography: string) {
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

function productPage(url: URL, name: string, title: string) {
  const path = url.pathname.replace(/\/$/, '');
  const host = url.hostname;
  const brand = words(name).replace(/ /g, '');
  const namedTitle = (words(title) + ' ').startsWith(words(name) + ' ');
  const slugMatches = (slug?: string) => !!slug && (
    words(slug).replace(/ /g, '') === brand || (' ' + words(slug) + ' ').includes(' ' + words(name) + ' ')
  );
  switch (host) {
    case 'apps.apple.com': {
      const app = /^\/[a-z]{2}\/app\/(?:([^/]+)\/)?id\d+$/.exec(path);
      return !!app && (app[1] ? slugMatches(app[1]) : namedTitle);
    }
    case 'apps.shopify.com': {
      const publisher = /-by-([\w-]+)$/.exec(path)?.[1];
      return /^\/[\w-]+$/.test(path) && (slugMatches(path) ||
        !!(publisher && words(name).startsWith(words(publisher) + ' ')));
    }
    case 'wordpress.org': return slugMatches(/^\/plugins\/([^/]+)$/.exec(path)?.[1]);
    case 'play.google.com': return namedTitle && path === '/store/apps/details' && /^[\w]+(?:\.[\w]+)+$/.test(url.searchParams.get('id') ?? '');
    case 'www.g2.com': return slugMatches(/^\/products\/([^/]+)(?:\/reviews)?$/.exec(path)?.[1]);
    case 'www.capterra.com': return slugMatches(/^\/p\/\d+\/([^/]+)$/.exec(path)?.[1]);
    case 'marketplace.microsoft.com': return namedTitle && /^\/(?:[a-z]{2}-[a-z]{2}\/)?product\/[^/]+\/[^/]+$/i.test(path);
    case 'aws.amazon.com': return namedTitle && /^\/marketplace\/pp\/(?:prodview-[\w-]+|[A-Z0-9]+)$/.test(path);
  }
  if (path && !/^\/(?:products?|features?|solutions?|pricing|platform|software)(?:\/|$)/.test(path)) {
    if (host === 'www.callrail.com' && path === '/call-tracking') return brand === 'callrail';
    return host === 'www.browserstack.com' && path === '/percy' && ['percy', 'browserstackpercy', 'percybybrowserstack'].includes(brand);
  }
  const parts = host.split('.');
  const publisher = parts.at(/\.(?:co|com|org|net)\.[a-z]{2}$/.test(host) ? -3 : -2);
  return publisher === brand || publisher === 'get' + brand ||
    (host === 'www.apollo.io' && path === '/product/b2b-data' && brand === 'apollodata');
}

function vendorEvidence(s: CommercialSource, name: string, offering: string, geography: string) {
  const safe = commercialUrl(s.url);
  if (!safe || !(' ' + words(s.title) + ' ').includes(' ' + words(name) + ' ')) return null;
  const url = new URL(safe);
  if (!productPage(url, name, s.title)) return null;

  // Return the publisher's wording. A matching domain alone cannot substantiate
  // a feature, and even a mostly accurate model paraphrase can add a false claim.
  const ignore = new Set(('the a an by for and or with that this from into our your available online software app ' +
    'platform product solution tools tool free trial pricing offers provides helps book request demo today learn more ' +
    words(name) + ' ' + words(geography)).split(' '));
  const terms = [...new Set(words(offering).split(' ').filter(w => w.length > 2 && !ignore.has(w)))];
  const description = s.snippet.split(/(?<=[.!?])\s+/).find(sentence => {
    if (/\b(?:does not|doesn't|cannot|can't|no longer|coming soon|wish list|plans to)\b/i.test(sentence)) return false;
    const tokens = new Set(words(sentence).split(' '));
    return terms.filter(t => tokens.has(t)).length >= Math.max(2, Math.ceil(terms.length / 2));
  });
  if (!description) return null;

  const country = url.hostname === 'apps.apple.com' ? url.pathname.split('/')[1] :
    url.hostname === 'play.google.com' ? url.searchParams.get('gl') : null;
  const storefront = country && /^[a-z]{2}$/i.test(country)
    ? new Intl.DisplayNames(['en'], { type: 'region' }).of(country.toUpperCase()) : undefined;
  const localOffer = s.snippet.split(/(?<=[.!?])\s+/).some(sentence => {
    if (/\b(?:not|except|excluding|unavailable|outside|coming soon|soon|planned)\b/i.test(sentence)) return false;
    const market = /\b(?:available (?:to (?:customers|users) )?in|serves(?: customers in)?|for subscribers in)\s+(?:the )?(.+)/i.exec(sentence);
    if (!market) return false;
    const region = market[1].split(/\s+(?:for|from|to|via|through|with)\b/i)[0];
    return region.split(/,|\band\b/i).some(part => {
      const place = words(part);
      return place === words(geography) ||
        (local(geography, 'United States') && /^(?:united states(?: of america)?|u s(?: a)?|usa?)$/.test(place));
    });
  });
  return { offering: description, confirmed: !!(country && (country.toLowerCase() === geography.toLowerCase() ||
    (storefront && local(storefront, geography)))) || localOffer };
}

function rounded(n: number) { return Number(n.toPrecision(12)); }

type CacReference = NonNullable<CommercialProfile['cacReferences']>[number];

function channelReference(p: CommercialProfile, sources: CommercialSource[], claim: z.infer<typeof channelObservation> | z.infer<typeof legacyCac>): CacReference | undefined {
  const s = observation(sources, claim, p.geography);
  if (!s || !/^S[1-9]\d*$/.test(s.id) || !s.publishedAt || s.publishedAt > p.researchedAt ||
      !commercialUrl(s.url)) return;
  const q = claim.quote;
  // Require the entire observation, including qualifiers. A substring can turn
  // "outside Canada" into "Canada" or hide that the denominator was a lead.
  const at = s.snippet.indexOf(q);
  if ((at && !/[.!?]\s+$/.test(s.snippet.slice(0, at))) ||
      (s.snippet.slice(at + q.length).trim() && !/[.!?]$/.test(q))) return;
  if (/[.!?]\s+\S/.test(q.replace(/\bU\.S\.(?:A\.)?/g, 'US'))) return;
  if (/\b(?:global|worldwide|international|across countries|outside|except|excluding|not|forecast|targeted cost|projected|hypothetical|estimated|up to|at least|from USD|between USD)\b/i.test(q) ||
      /(?:\b(?:CAD|AUD|NZD|GBP|EUR)|[€£¥])/.test(q)) return;
  const scope = words(q);
  const geo = local(p.geography, 'United States') ? /\b(?:united states(?: of america)?|usa|us)\b/g :
    new RegExp('\\b' + words(p.geography).split(' ').join('\\s+') + '\\b', 'g');
  const scoped = scope.replace(geo, 'LOCAL');
  if (/\b(?:and|or|including|except|outside|excluding|versus|vs) LOCAL\b|\bLOCAL (?:and|or|versus|vs|only accounted)\b/.test(scoped)) return;
  const amounts = [...q.matchAll(/(?<![\w$])(?:(USD)\s*\$?|(US\$)|(\$))\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:per|\/)\s*(?:a\s+)?(click|lead|(?:new(?:ly acquired)?|first[- ]time) paying customer)\b/gi)];
  if (amounts.length !== 1) return;
  const [, explicit, usDollar, , amount, denominator] = amounts[0];
  if (!explicit && !usDollar && !local(p.geography, 'United States')) return;
  const usd = Number(amount.replace(/,/g, ''));
  if (!Number.isFinite(usd) || usd <= 0 || usd > Number.MAX_SAFE_INTEGER) return;
  const unit = /customer/i.test(denominator) ? 'paying customer' : denominator.toLowerCase() as 'lead' | 'click';
  const modern = 'unit' in claim;
  if (modern && (claim.unit !== unit || ![claim.cohort, claim.channel, claim.period].every(v => q.includes(v)) ||
      !/\b(?:19|20)\d{2}\b/.test(claim.period))) return;
  const cohort = modern ? claim.cohort : p.industry;
  if (!cohort || !scope.includes(words(cohort))) return;
  const specific = (v: string) => words(v).split(' ').filter(w => w.length > 2 &&
    !/^(?:the|for|and|business|businesses|buyers?|customers?|users?|paying|companies|teams?|professionals?)$/.test(w));
  const relevant = unit === 'paying customer' ? p.payer : [p.industry, p.payer].filter(Boolean).join(' ');
  if (!relevant || !specific(relevant).some(w => (' ' + words(cohort) + ' ').includes(' ' + w + ' '))) return;
  if (unit === 'paying customer') {
    if (!modern || !/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/\d+\/[^/]+\.htm(?:l)?$/i.test(s.url) ||
        !/\b(?:our|we)\b/i.test(q) || !/\b(?:sales|marketing|acquisition)\s+(?:costs?|spend(?:ing)?|expenses?)\b/i.test(q)) return;
  } else if (!/\b(?:ads?|advertis(?:ing|ers?)|paid|ppc|sem|sponsored)\b/i.test(q) ||
      (!modern && claim.costPerContactUsd !== usd)) return;
  return {
    publisher: new URL(s.url).hostname, geography: p.geography, scope: 'matched', cohort, period: modern ? claim.period : 'Study period unspecified',
    channel: claim.channel, unit, usd, methodology: q, sourceIds: [s.id],
  };
}

function addAcquisition(p: CommercialProfile, sources: CommercialSource[], data: z.infer<typeof analysis>, cited: Set<string>) {
  const refs: CacReference[] = [];
  for (const s of sources) {
    if (!/^A[1-9]\d*$/.test(s.id) || !s.publishedAt || s.publishedAt > p.researchedAt) continue;
    const ref = acquisitionReference(s);
    if (ref && (ref.scope === 'external' || acquisitionGeoMatches(ref, p.geography))) refs.push(ref);
  }
  const cac = data.cac;
  const searchClaim = data.acquisitionBenchmark ?? (cac && !cac.kind ? cac : undefined);
  const searchRef = searchClaim && channelReference(p, sources, searchClaim);
  if (searchRef) refs.push(searchRef);
  if (!refs.length) return;
  p.cacReferences = refs;
  refs.forEach(r => cited.add(r.sourceIds[0]));
  if (!cac) return;
  const ref = refs.find(r => r.sourceIds.includes(cac.sourceId));
  if (!ref || (ref !== searchRef && !acquisitionGeoMatches(ref, p.geography))) return;
  const { channel, usd: cost, sourceIds } = ref;
  if (cac.kind === 'observed') {
    if (ref.unit === 'paying customer') {
      p.cac = { kind: 'observed', channel, usd: { low: cost, base: cost, high: cost }, assumptions: cac.assumptions, sourceIds };
    }
    return;
  }
  if (ref.unit === 'paying customer' || (!cac.kind && ref !== searchRef)) return;
  if (/\b(?:leads?|signups?|trials?|form submissions?)\b/i.test(cac.assumptions) &&
      !/\b(?:paying|paid (?:customers?|orders?|subscriptions?|contracts?)|purchases?)\b/i.test(cac.assumptions)) return;
  const f = cac.conversion;
  if (cost / f.low > Number.MAX_SAFE_INTEGER) return;
  p.cac = {
    kind: 'scenario', channel, usd: { low: rounded(cost / f.high), base: rounded(cost / f.base), high: rounded(cost / f.low) },
    assumptions: 'USD ' + cost + '/' + ref.unit + ' ÷ assumed ' + ref.unit + '-to-paying-customer conversion (' +
      [f.high, f.base, f.low].join(' / ') + ' for low / base / high CAC). Media cost only. ' + cac.assumptions,
    sourceIds,
  };
}

export function buildCommercial(
  raw: unknown, sources: CommercialSource[], geography: string, researchedAt: string,
  marketSources: MarketSource[] = [],
): CommercialProfile | null {
  const parsed = analysis.safeParse(raw);
  if (!parsed.success || sources.length === 0) return null;
  const { businessModel, user, payer, industry, market, execution } = parsed.data;
  const p: CommercialProfile = { geography, businessModel, user, payer, industry: industry ?? parsed.data.endUseIndustry, researchedAt, sources: [] };
  const cited = new Set<string>();
  const reference = marketSources.find(s =>
    (s.id === parsed.data.marketReferenceId || s.id === market?.sourceId) &&
    sources.some(source => source.id === s.id && source.url === s.url)
  );
  if (reference) {
    p.marketReference = { population: reference.population, unit: reference.unit, period: reference.period, sourceIds: [reference.id] };
    cited.add(reference.id);
  } else if (parsed.data.observedMarket) {
    const obs = parsed.data.observedMarket;
    const source = observation(sources, obs, geography);
    const publicStatistics = source && /(?:\.gov(?:\.[a-z]{2})?|\.gc\.ca|\.gouv\.fr|\.europa\.eu)$/i.test(new URL(source.url).hostname);
    if (source && publicStatistics && hasCount(obs.quote, obs.population) &&
        obs.year <= Number(researchedAt.slice(0, 4)) && obs.quote.includes(String(obs.year)) &&
        words(obs.unit).length > 1 && (' ' + words(obs.quote) + ' ').includes(' ' + words(obs.unit) + ' ')) {
      p.marketReference = { population: obs.population, unit: obs.unit, period: String(obs.year), sourceIds: [source.id] };
      cited.add(source.id);
    }
  }

  for (const item of parsed.data.competition ?? []) {
    const result = vendor.safeParse(item);
    if (!result.success) continue;
    const { name, offering, sourceIds } = result.data;
    if (p.competition?.some(c => words(c.name) === words(name))) continue;
    const verified = sources.flatMap(s => {
      const evidence = sourceIds.includes(s.id) && vendorEvidence(s, name, offering, geography);
      return evidence ? [{ ...evidence, id: s.id }] : [];
    });
    if (!verified.length) continue;
    (p.competition ??= []).push({ name, offering: verified[0].offering, sourceIds: verified.map(s => s.id),
      availability: verified.some(s => s.confirmed) ? 'confirmed' : 'unconfirmed' });
    verified.forEach(s => cited.add(s.id));
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
  addAcquisition(p, sources, parsed.data, cited);
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
