import { fetchWithTimeout } from '../ingest/adapters/shared';
import type { CommercialSource } from './commercial';
import type { OppDraft } from './engine';

/** Observed denominators only. Eligibility, customer conversion and revenue are separate estimates. */
export type MarketSource = CommercialSource & { population: number; unit: string; period: string };
type Observation = Omit<MarketSource, 'id'>;
type MarketDraft = Pick<OppDraft, 'title' | 'researchTarget' | 'kpis'>;
const usGeography = /^(?:united states(?: of america)?|u\.?s\.?(?:a\.?)?)$/i;

function observation(
  title: string, url: string, population: number, unit: string, period: string, released: string, scope: string,
): Observation {
  return {
    title, url, population, unit, period, publishedAt: released + 'T00:00:00.000Z',
    snippet: 'United States, ' + period + ': ' + population.toLocaleString('en-US') + ' ' + unit +
      '. Parent population. ' + scope,
  };
}

// Verified from cbp23us.txt: USCODE=98, LFO="-", EST for each 2017 NAICS row.
// The Census CBP download index listed 2023 as its newest year on 2026-11-24.
// 5617 is stored as "5617//". Use the national all-legal-forms row once;
// summing it with subindustries or legal-form rows would double-count locations.
const cbpUrl = 'https://www.census.gov/data/datasets/2023/econ/cbp/2023-cbp.html';
type Industry = [payer: RegExp, naics: string, population: number, industry: string];
const digitalAgency = /\b(?:digital (?:advertising|marketing)|ppc|pay per click|paid search) agenc(?:y|ies)\b/;
const advertisingParent: Industry = [digitalAgency, '5418', 38_864, 'advertising, public relations, and related services'];
const industries: Industry[] = [
  advertisingParent,
  [/\b(?:advertising|ad|performance marketing) agenc(?:y|ies)\b/, '541810', 15_512, 'advertising agencies'],
  [/\b(?:paid media|media buying) agenc(?:y|ies)\b/, '541830', 767, 'media buying agencies'],
  [/\b(?:public relations|pr) (?:firms?|agenc(?:y|ies))\b/, '541820', 8_646, 'public relations agencies'],
  [/\bmarketing agenc(?:y|ies)\b/, '5418', 38_864, 'advertising, public relations, and related services'],
  [/\bmarketing consult(?:ant|ancy|ancies|ing)\b|\bmarketing consultants\b/, '541613', 52_258, 'marketing consulting services'],
  [/\bgraphic design (?:studios?|firms?|agencies|shops?)\b/, '541430', 15_828, 'graphic design services'],
  [/\b(?:web|website|custom software) development (?:firms?|companies|shops?|agenc(?:y|ies))\b/, '541511', 68_051, 'custom computer programming services'],
  [/\b(?:janitorial|commercial cleaning|office cleaning) (?:service|business|firm|contractor|compan|provider)/, '561720', 67_799, 'janitorial services'],
  [/\blandscap(?:e|ing) (?:service|business|firm|contractor|compan|provider)/, '561730', 117_969, 'landscaping services'],
  [/\bpest control (?:service|business|firm|contractor|compan|operator)/, '561710', 16_535, 'exterminating and pest control services'],
  [/\bcarpet clean(?:ing|ers?)\b/, '561740', 6_673, 'carpet and upholstery cleaning services'],
  [/\bbuilding (?:services?|maintenance) (?:business|firm|contractor|compan|provider|operator|employer|establishment)/, '5617', 227_045, 'services to buildings and dwellings'],
  [/\b(?:hvac|plumbing|heating and air conditioning) (?:service|business|firm|contractor|compan|shop)/, '238220', 111_207, 'plumbing, heating and air-conditioning contractors'],
  [/\bresidential property manag(?:ement|ers?)\b/, '531311', 60_818, 'residential property managers'],
  [/\b(?:cpa|certified public account(?:ant|ing)) firms?\b/, '541211', 55_052, 'offices of certified public accountants'],
  [/\b(?:law firms?|law offices?)\b/, '541110', 165_491, 'offices of lawyers'],
  [/\b(?:dental|dentist) (?:practices?|offices?|clinics?)\b/, '621210', 135_665, 'offices of dentists'],
  [/\b(?:day care|daycare|child care|childcare) (?:centers?|operators?|providers?)\b/, '624410', 82_162, 'child day care services'],
  [/\b(?:sit down|full service) restaurants?\b/, '722511', 258_626, 'full-service restaurants'],
];

const blsWeb = 'https://www.bls.gov/ooh/computer-and-information-technology/web-developers.htm';
const tenure = 'https://data.census.gov/table/ACSDT1Y2025.B25003';
const caregiving = 'https://www.aarp.org/press/releases/2025-07-24-new-report-reveals-crisis-point-for-americas-63-million-family-caregivers.html';

function publishedSurvey(payer: string): Observation | undefined {
  const individual = !/\b(?:firm|agency|agencies|compan(?:y|ies)|employer|association|platform|studio|provider|insurer|carrier|landlord)s?\b/.test(payer);
  if (individual && /\b(?:web|website|digital interface) (?:designers?|developers?|builders?)\b/.test(payer)) {
    const design = /\bdesigners?\b/.test(payer);
    return observation('BLS Occupational Outlook Handbook · Web occupations', blsWeb, design ? 132_700 : 87_400,
      design ? 'web and digital interface designer jobs' : 'web developer jobs', '2025', '2026-08-27',
      'Approximate occupational employment across employers and self-employment. Workers can hold multiple jobs.');
  }
  if (individual && /\b(?:family|unpaid|informal) caregivers?\b/.test(payer)) {
    return observation('AARP and National Alliance for Caregiving · Caregiving in the U.S. 2025', caregiving,
      63_000_000, 'family caregivers', '2025', '2025-07-24',
      'Rounded survey estimate of adults providing ongoing care in the previous year to a child or adult with complex needs.');
  }
  if (individual && /\b(?:renters?|tenants?|homeowners?|home owners?)\b/.test(payer)) {
    const renter = /\b(?:renters?|tenants?)\b/.test(payer);
    return observation('Census ACS 1-year estimates · Tenure (B25003)', tenure,
      renter ? 46_551_688 : 87_511_734, renter ? 'renter-occupied housing units' : 'owner-occupied housing units',
      '2025', '2026-10-29', 'Survey estimate of occupied units; one unit may house several people. 90% margin of error ±' +
      (renter ? '193,219' : '290,818') + ' units.');
  }
}

// Public country-report snapshots verified 2026-11-20 (publisher's update date).
const platforms = [
  { name: 'Shopify', count: 1_326_871 }, { name: 'Wix', count: 276_880 },
  { name: 'Squarespace', count: 305_800 }, { name: 'Webflow', count: 9_337 },
];
const snapshotDate = '2026-11-20';

async function platformReport(platform: typeof platforms[number]): Promise<Observation> {
  const name = platform.name;
  const url = 'https://storeleads.app/reports/' + name.toLowerCase() + '/US/top-stores';
  let population = platform.count;
  let period = snapshotDate;
  try {
    const response = await fetchWithTimeout(url, {}, { timeoutMs: 4_000 });
    const html = await response.text();
    const heading = /<h1\b[^>]*>([^<]*)<\/h1>/i.exec(html);
    if (heading && heading[1].trim() === name + ' Stores in the United States') {
      const header = html.slice(heading.index + heading[0].length, heading.index + heading[0].length + 1800);
      const date = /<time\b[^>]*\bdatetime=["'](\d{4}-\d{2}-\d{2})(?:[ T][^"']*)?["']/i.exec(header)?.[1];
      const text = header.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
      const match = new RegExp('There are (\\d{1,3}(?:,\\d{3})+|\\d+) live ' + name + ' stores in the United States\\.').exec(text);
      const count = match ? Number(match[1].replaceAll(',', '')) : 0;
      const utc = date ? Date.parse(date + 'T00:00:00Z') : NaN;
      if (date && date >= snapshotDate && utc <= Date.now() && new Date(utc).toISOString().startsWith(date + 'T') &&
          Number.isSafeInteger(count) && count > 0) {
        period = date;
        population = count;
      }
    }
  } catch { /* The verified observation retains its original date on a failed refresh. */ }
  return observation('Store Leads · ' + name + ' stores in the United States', url, population,
    'active ' + name + ' stores', period, period, 'Tracker counts live storefronts. One merchant can operate multiple stores.');
}

const head = (s: string) => s.toLowerCase().replace(/[-–—]/g, ' ')
  .split(/\b(?:serving|targeting|managing (?!partner)|advising|selling to|on behalf of|working with|whose|who|for)\b/)[0].trim();

function economicPayer(d: MarketDraft): string {
  const audience = d.researchTarget ?? d.kpis.audience;
  const pricePayer = d.kpis.priceBasis?.payer?.trim() ?? '';
  // "The managing partner approves the monthly subscription" describes a
  // billing role. A named payer such as an insurer takes precedence over
  // model-generated audience/population fields even when we have no insurer series.
  const billingRole = /^(?:the |an? )?(?:budget owner|owner|founder|cofounder|managing partner|finance director|cfo|procurement manager)(?:\s+(?:pays|approves|authorizes|signs)(?:\s+(?:the|a|an|monthly|annual|subscription|fee|contract|purchase|invoice|bill|plan|payment))*[.!]?)?$/i;
  const rawPayer = pricePayer && !/^unspecified$/i.test(pricePayer) && !billingRole.test(pricePayer)
    ? pricePayer : audience?.payer;
  return head(rawPayer ?? '');
}

export function marketSpendingSource(d: MarketDraft, geo: string):
  { usd: number; category: string; period: string; source: CommercialSource } | undefined {
  const audience = d.researchTarget ?? d.kpis.audience;
  if (!usGeography.test(geo.trim()) || !/\baffiliate marketing\b/i.test(audience?.industry ?? '')) return;
  if (!/\b(?:affiliate (?:marketers?|publishers?)|media buying teams?)\b/.test(economicPayer(d))) return;
  return {
    usd: 13_630_000_000, category: 'Merchant spending on affiliate marketing', period: '2024',
    source: {
      id: 'T1', title: 'PMA 2025 study · 2024 US merchant spending on affiliate marketing',
      url: 'https://thepma.org/wp-content/uploads/edd/2025/06/PMA-Industry-Study-2025.pdf',
      snippet: 'The PMA estimates merchants spent $13.63 billion on affiliate marketing in the United States in 2024. This sector total includes commissions, ad placements and technology fees.',
      publishedAt: null,
    },
  };
}

/** Match the economic payer before consulting industry or platform context. */
export async function marketSources(d: OppDraft, geography: string): Promise<MarketSource[]> {
  if (!usGeography.test(geography.trim())) return [];
  const audience = d.researchTarget ?? d.kpis.audience;
  const payer = economicPayer(d);
  if (!payer || payer === 'unspecified') return [];
  const segment = head(d.researchTarget?.population ?? '');
  // A retailer's technology may qualify its storefronts. Naming Shopify in a
  // thesis, acquisition channel, client list or competitor is insufficient.
  const merchant = /\b(?:merchants?|retailers?|sellers?|stores?|storefronts?|(?:shop|e ?commerce|dtc|d2c) (?:owners?|operators?|brands?))\b/;
  const intermediary = /\b(?:agenc(?:y|ies)|consultants?|vendors?|shoppers?|buyers?|developers?|platforms?|providers?)\b/;
  const references: Observation[] = [];
  if (merchant.test(payer) && !intermediary.test(payer)) {
    const named = (s: string) => platforms.filter(p => new RegExp('\\b' + p.name + '\\b', 'i').test(s));
    // Explicit payer platform wins. A structured population may qualify
    // "online merchants", but must itself refer to a merchant-side population.
    let selected = named(payer);
    if (!selected.length && !/\b(?:woocommerce|bigcommerce|magento|prestashop|etsy|amazon|ebay)\b/.test(payer)) {
      if (merchant.test(segment) && !intermediary.test(segment)) selected = named(segment);
      if (!selected.length) selected = named(audience?.industry ?? '');
    }
    references.push(...await Promise.all(selected.slice(0, 2).map(platformReport)));
  }
  if (!references.length) {
    let industry = industries.find(([pattern]) => pattern.test(payer));
    if (!industry && /^(?:ppc or )?local services? agenc(?:y|ies)$|^agency owner$/.test(payer) &&
        digitalAgency.test(head(audience?.industry ?? '')) && /\bagenc(?:y|ies)\b/.test(head(audience?.payer ?? ''))) {
      industry = advertisingParent;
    }
    if (!industry && segment) {
      const candidate = industries.find(([pattern]) => pattern.test(segment));
      if (candidate) {
        // Require an activity word from the actual payer, or an otherwise
        // unspecialized agency payer with independent marketing-industry context.
        const activity = candidate[3].split(/\W+/).filter(w =>
          w.length >= 4 && !['services', 'agencies', 'related', 'offices', 'contractors', 'companies', 'managers'].includes(w));
        const organization = /\b(?:firms?|companies|company|contractors?|agencies|agency|practices?|offices?|business(?:es)?|providers?)\b/;
        const sameActivity = organization.test(payer) && activity.some(w => new RegExp('\\b' + w + '\\b').test(payer));
        const genericAgency = /^(?:(?:owners? of|small|independent|boutique|digital|the|an?) )*agenc(?:ies|y)(?: owners?| principals?)?$/;
        const agencyFit = genericAgency.test(payer) && /\b(?:marketing|advertising)\b/i.test(audience?.industry ?? '') &&
          /\b(?:advertising|marketing)\b/.test(candidate[3]);
        if (sameActivity || agencyFit) industry = candidate;
      }
    }
    if (industry) {
      const [, code, count, label] = industry;
      references.push(observation('Census County Business Patterns · NAICS ' + code, cbpUrl, count,
        'employer establishments in ' + label, '2023', '2025-06-26',
        'Employer locations only. A firm can run several locations; nonemployer businesses are excluded.'));
    } else {
      const survey = publishedSurvey(payer);
      if (survey) references.push(survey);
    }
  }
  return references.map((s, index) => ({ ...s, id: 'M' + (index + 1) }));
}
