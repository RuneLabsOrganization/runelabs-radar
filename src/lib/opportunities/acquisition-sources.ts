import type { CommercialProfile, CommercialSource } from './commercial';
import type { OppDraft } from './engine';

export const ACQUISITION_INSTRUCTIONS = [
  'For acquisition prefer supplied acquisition sources (A1, A2, …). Read the publisher, cohort, geography, period, denominator and methodology in the source snippet. Emit cac only when the source applies to the proposed seller, buyer and paid channel.',
  'For a geographically matched cohort with measured spend per newly paying customer, emit {"kind":"observed","sourceId":"A1","assumptions":"Explain buyer and seller fit, cohort differences and costs included."}. This is the publisher cohort’s observed CAC. The opportunity’s own CAC is unknown.',
  'For a comparable CPC or CPL benchmark, emit {"kind":"scenario","sourceId":"A1","conversion":{"low":0.01,"base":0.02,"high":0.04},"assumptions":"Justify each conversion assumption from the benchmark unit to a new paying customer and identify costs excluded."} only if you can defend those fractions. The fractions shown are schema examples; never use them as defaults. Do not use click-to-lead conversion as click-to-paying-customer conversion.',
  'If conversion is unsupported, omit cac. A matched benchmark can be shown separately with its publisher, geography, cohort and limits. Never report a broad average, proxy, or nonlocal benchmark as local observed CAC. Do not supply or infer a benchmark dollar amount.',
  'For a dated primary S-series channel observation, also supply acquisitionBenchmark:{sourceId,quote,channel,cohort,period,unit}. Copy a complete verbatim statement naming the local geography, relevant advertising or paying cohort, period, and USD amount per click, lead or new paying customer. Use exact source text for channel, cohort and period. Set unit to "click", "lead" or "paying customer". For observed customer CAC use an issuer filing documenting sales/marketing spend per newly acquired paying customer. For scenarios use only explicit per-click or per-lead costs and conversion all the way to a paying customer. The same cac variants accept the selected S-series ID. Omit cac if only the benchmark is supportable.',
].join('\n');

type Reference = NonNullable<CommercialProfile['cacReferences']>[number];
type Benchmark = Omit<Reference, 'sourceIds' | 'scope'> & Pick<CommercialSource, 'url' | 'publishedAt'>;

const us = (geo: string) => /^(?:united states(?: of america)?|u\.?s\.?a?\.?)$/i.test(geo.trim());

function localiq(category: string, usd: number): Benchmark {
  return {
    publisher: 'LocaliQ / WordStream', geography: 'United States', cohort: category + ' advertisers',
    unit: 'click', usd, channel: 'Google and Microsoft search ads', period: 'Apr 2025–Mar 2026',
    methodology: 'Median campaign CPC. The study covered 13,474 US campaigns across industries. No SMB, buyer-role or paying-customer conversion breakdown.',
    url: 'https://www.wordstream.com/blog/2026-google-ads-benchmarks', publishedAt: '2026-05-18T00:00:00.000Z',
  };
}
const services = localiq('Business Services', 5.87);
const education = localiq('Education & Instruction', 4.81);
const restaurants = localiq('Restaurants & Food', 2.05);
const mealKits: Benchmark = {
  publisher: 'Blue Apron', geography: 'United States', cohort: 'Blue Apron direct-to-consumer customers',
  channel: 'Blended marketing', period: '2014–Q1 2017', unit: 'paying customer', usd: 94,
  methodology: 'Marketing expense divided by customers placing their first paid order. Includes retention and engagement spending. Historical single-company result across its offerings.',
  url: 'https://www.sec.gov/Archives/edgar/data/1701114/000104746917004316/a2232581z424b4.htm', publishedAt: '2017-06-28T00:00:00.000Z',
};
const webinars: Benchmark = {
  publisher: 'Banzai', geography: 'All reported markets (no geographic breakdown)', cohort: 'Demio webinar software subscribers',
  channel: 'Blended sales and marketing', period: 'FY 2024', unit: 'paying customer', usd: 1519,
  methodology: 'Sales and marketing spend divided by newly acquired paying customers. Single product across customer sizes. Country-specific and SMB-only CAC unavailable.',
  url: 'https://www.sec.gov/Archives/edgar/data/1826011/000095017025054303/bnzi-20241231.htm', publishedAt: '2025-04-15T00:00:00.000Z',
};
const emailMarketing: Benchmark = {
  publisher: 'Constant Contact', geography: 'All reported markets (no geographic breakdown)', cohort: 'Small organizations buying email marketing, including businesses, associations and nonprofits',
  channel: 'Blended sales and marketing', period: 'FY 2008', unit: 'paying customer', usd: 304,
  methodology: 'Approximate annual sales and marketing expense per gross new email-marketing customer. Historical single-company dollars. No current, country-specific or agency-only estimate.',
  url: 'https://www.sec.gov/Archives/edgar/data/1405277/000095013509001699/b73478cce10vk.htm', publishedAt: '2009-03-12T00:00:00.000Z',
};
const b2bSaas: Benchmark = {
  publisher: 'First Page Sage', geography: 'Geography unspecified', cohort: 'B2B SaaS in agency client data and research',
  channel: 'Paid search and paid social', period: 'Jan 2022–Oct 2026', unit: 'paying customer', usd: 357,
  methodology: 'Paid CAC is weighted toward paid search. The publisher also reports USD 243 combined using 75% organic and 25% paid. Excludes email and offline channels. SaaS cohort size and country mix undisclosed.',
  url: 'https://firstpagesage.com/reports/average-customer-acquisition-cost-cac-by-industry-b2b-edition-fc/', publishedAt: '2026-11-04T00:00:00.000Z',
};
const b2cSaas: Benchmark = {
  publisher: 'First Page Sage', geography: 'Geography unspecified', cohort: 'Consumer SaaS in agency client data and research',
  channel: 'Paid search and paid social', period: '2021–Oct 2026', unit: 'paying customer', usd: 223,
  methodology: 'Paid CAC across search and social. The study included 103 B2C clients across industries. Excludes email and offline channels. SaaS cohort size and country mix undisclosed.',
  url: 'https://firstpagesage.com/reports/average-cac-by-industry-b2c-edition/', publishedAt: '2026-11-04T00:00:00.000Z',
};
const catalog = [services, education, restaurants, mealKits, webinars, emailMarketing, b2bSaas, b2cSaas];

function sourceFor(b: Benchmark, id: string): CommercialSource {
  return {
    id, title: b.publisher + ' · ' + b.cohort, url: b.url, publishedAt: b.publishedAt,
    snippet: [b.publisher, b.geography, b.cohort, b.period, b.channel, 'USD ' + b.usd + ' per ' + b.unit + '.', b.methodology].join(' · '),
  };
}

export function acquisitionReference(source: CommercialSource): Reference | undefined {
  if (!/^A[1-9]\d*$/.test(source.id)) return;
  const b = catalog.find(b => b.url === source.url && b.publishedAt === source.publishedAt &&
    sourceFor(b, source.id).snippet === source.snippet);
  if (!b) return;
  const { publisher, geography, cohort, unit, usd, channel, period, methodology } = b;
  return { publisher, geography, scope: geography === 'United States' ? 'matched' : 'external',
    cohort, unit, usd, channel, period, methodology, sourceIds: [source.id] };
}

export function acquisitionGeoMatches(reference: Reference, geo: string) {
  return us(geo) && reference.geography === 'United States';
}

export async function acquisitionSources(d: OppDraft, geo: string): Promise<CommercialSource[]> {
  const target = d.researchTarget;
  if (!target || !geo.trim()) return [];
  // The end-use industry can describe the buyer. Only match the category of
  // product sold; e.g. restaurant accounting software isn't a restaurant ad.
  const seller = (target.sellerCategory ?? '').toLowerCase().replace(/[-‐‑–]/g, ' ').trim();
  const payer = target.payer.toLowerCase();
  const business = ['B2B', 'B2B2C', 'marketplace', 'prosumer', 'other'].includes(target.businessModel) &&
    /\b(?:agenc(?:y|ies)|business(?:es)?|teams?|companies|firms?|smbs?|marketers?|operators?|advertisers?|merchants?|professionals?|consultants?|employers?|owners?|departments?)\b/.test(payer);
  const consumer = ['B2C', 'B2B2C', 'marketplace', 'prosumer', 'other'].includes(target.businessModel);
  const selected: Benchmark[] = [];
  if (business) {
    const marketing = /\b(?:marketing|martech|seo|advertising|webinar|demand generation)\b/.test(seller) &&
      /\b(?:software|tools?|platform|saas|automation|services?|agenc(?:y|ies)|analytics|management)\b/.test(seller);
    const businessService = /\b(?:business|b2b|smb)\s+(?:services?|consulting|accounting|payroll|bookkeeping)\b/.test(seller);
    if (us(geo) && (marketing || businessService)) selected.push(services);
    const marketingSoftware = marketing && /\b(?:software|platform|saas|tools?|automation|analytics)\b/.test(seller);
    if (marketingSoftware && /\b(?:smbs?|small businesses|small business|small organizations?|nonprofits?|small agenc(?:y|ies))\b/.test(payer)) {
      selected.push(emailMarketing);
    }
    if (marketingSoftware && /\b(?:marketing|marketers?|agenc(?:y|ies)|events?|sales)\b/.test(payer)) selected.push(webinars);
  }
  if (consumer && us(geo)) {
    if (/^(?:direct to consumer |consumer |d2c )?meal kits?(?: (?:subscriptions?|delivery|services?))*$/.test(seller) &&
        /\b(?:households?|families|consumers?|home cooks?|parents?)\b/.test(payer)) selected.push(mealKits);
    if (/^(?:online |private )?(?:tutoring|courses?|education|instruction)(?: services?)?$/.test(seller) &&
        /\b(?:students?|learners?|parents?|families)\b/.test(payer)) selected.push(education);
    if (/^(?:restaurant|takeout|catering)(?: meals?| services?| food)?$/.test(seller) &&
        /\b(?:diners?|households?|consumers?|families)\b/.test(payer)) selected.push(restaurants);
  }
  const product = seller.replace(/\bsoftware as a service\b/g, 'saas');
  const software = /\b(?:saas|software|subscription app)\b/.test(product) &&
    !/\b(?:development|implementation|consulting|reseller|hardware|services?)\b/.test(product);
  const consumerPayer = /\b(?:consumers?|households?|families|students?|parents?|individuals?|home users?|hobbyists?|creators?|learners?)\b/.test(payer);
  if (software && payer && !/\b(?:unspecified|unknown|tbd)\b/.test(payer)) {
    if (business || (target.businessModel === 'B2B' && !consumerPayer)) selected.push(b2bSaas);
    else if ((target.businessModel === 'B2C' && !/\b(?:companies|agencies|businesses|employers)\b/.test(payer)) ||
             (consumer && consumerPayer)) selected.push(b2cSaas);
  }
  return selected.map((b, i) => sourceFor(b, 'A' + (i + 1)));
}
