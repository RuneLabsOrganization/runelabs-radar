import type { CommercialProfile, CommercialSource } from './commercial';
import { matchedUsComparable } from './comparable-product';

type ReachableMarket = NonNullable<CommercialProfile['market']>;
type Estimate = { market: Omit<ReachableMarket, 'sourceIds'>; sources: Omit<CommercialSource, 'id'>[] };

const recordsPerWeek = { low: 5, base: 15, high: 40 } as const;
const weeks = 48;
const capacityNote = `12 months, licensed list: L/B/H ${recordsPerWeek.low}/${recordsPerWeek.base}/${recordsPerWeek.high} records/week × ${weeks} weeks, capped at list size. Excludes buyers outside the list. `;
function screened(size: number, scenario: keyof typeof recordsPerWeek) {
  return Math.min(size, recordsPerWeek[scenario] * weeks);
}

// Recorded from the US country pages on 2026-11-24. Size/industry screens
// below use only the first ten named rows; ordering is not random.
const companyLists = {
  optmyzr: {
    name: 'Optmyzr', size: 50, fits: [1, 2, 3],
    buyer: 'Reachable US PPC agencies in the Optmyzr company list',
    screen: 'advertising services',
    sample: 'Advertising Services rows: Marketing Direction (8 employees), Beeby Clark+Meyler (36), Etna Interactive (72), Ignite Visibility (434).',
  },
  voluum: {
    name: 'Voluum', size: 28, fits: [1, 3, 4],
    buyer: 'Reachable US media-buying teams in the Voluum company list',
    screen: 'advertising or marketing services',
    sample: 'Advertising/Marketing Services rows: SkyHouse Agency (13 employees), Giraffe Media Group (27), Motive Interactive (50), Suited Connector (86), MGID (640).',
  },
} as const;

function companyEstimate(product: keyof typeof companyLists): Estimate {
  const { name, size, fits, buyer, screen, sample } = companyLists[product];
  // Low counts only named records passing the strict screen. Base/high
  // conditionally extend the preview mix to the rest of the screened list.
  const project = (scenario: 'base' | 'high', eligibleInTen: number) =>
    Math.floor(screened(size, scenario) * eligibleInTen / 10);
  return {
    market: {
      buyer,
      buyerCounts: { low: Math.min(screened(size, 'low'), fits[0]), base: project('base', fits[1]), high: project('high', fits[2]) },
      assumptions: capacityNote + 'US 2026-11-24: all ' + size + ' records fit capacity. In the first 10, ' + fits.join('/') +
        ' meet assumed ' + screen + ' and ≤25/50/100 staff screens; need is unmeasured. Low counts only the ' + fits[0] +
        ' named match. Base/high = floor(' + size + ' × ' + fits[1] + '/10 or ' + fits[2] +
        '/10), assuming the nonrandom preview mix holds. Assume one payer per firm and a reachable decision maker; parent or global approval may be required.',
    },
    sources: [{
      title: 'TheirStack · US companies using ' + name,
      url: 'https://theirstack.com/en/technology/' + product + '/us',
      snippet: 'Observed 2026-11-24: ' + size + ' US companies listed with ' + name +
        ' usage signals; ten named records on page one. ' + sample + ' Records indicate technology use, not verified subscriptions.',
      publishedAt: null,
    }],
  };
}

function storefrontEstimate(): Estimate {
  const installs = 4_009;
  const usStores = 1_326_871;
  const pixel = 383_831;
  const email = 699_096;
  const phone = 364_067;
  const pool = (scenario: keyof typeof recordsPerWeek, storesPerBuyer: number, contactable: number) =>
    Math.floor(screened(installs, scenario) / storesPerBuyer * (pixel / usStores) * (Math.min(contactable, usStores) / usStores));
  const reportDate = '2026-11-20T00:00:00.000Z';
  return {
    market: {
      buyer: 'Reachable US merchant organizations with Elevar on Shopify and Google Ads tracking',
      buyerCounts: { low: pool('low', 3, phone), base: pool('base', 2, email), high: pool('high', 1, email + phone) },
      assumptions: capacityNote + 'US 2026-11-20: screen 240/720/1,920 of 4,009 installs. Pool = floor(screened ÷ assumed 3/2/1 stores per payer × fit × reach). ' +
        'Fit proxy: Google Ads Pixel 383,831/1,326,871. Reach: phone/email/either 364,067/699,096/1,063,163 ÷ 1,326,871; high assumes no overlap. ' +
        'Assume US Shopify rates apply independently to Elevar and listed contacts reach decision makers. Need and parent approval unverified.',
    },
    sources: [
      { title: 'Store Leads · Elevar Conversion Tracking Shopify app, country table',
        url: 'https://storeleads.app/reports/shopify/app/gtm-datalayer-by-elevar',
        snippet: 'The 2026-11-20 country table reports 4,009 US Shopify stores with the Elevar Conversion Tracking app installed.',
        publishedAt: reportDate },
      { title: 'Store Leads · Google Ads Pixel on US ecommerce stores, platform table',
        url: 'https://storeleads.app/reports/technology/Google%20Ads%20Pixel/country/US',
        snippet: 'On 2026-11-20 Store Leads detected the Google Ads Pixel on 383,831 US Shopify stores. This is the platform-wide count; the overlap with Elevar is unobserved.',
        publishedAt: reportDate },
      { title: 'Store Leads · US Shopify stores and business contact channels',
        url: 'https://storeleads.app/reports/shopify/US/top-stores',
        snippet: 'On 2026-11-20 Store Leads listed 1,326,871 US Shopify stores, including 699,096 with email and 364,067 with a phone number. A store may list both.',
        publishedAt: reportDate },
      { title: 'Shopify Help Center · Expansion stores under one organization',
        url: 'https://help.shopify.com/en/manual/organization-settings/expansion-stores',
        snippet: 'A Shopify Plus organization can operate distinct retail, wholesale and expansion storefronts under one contract. Typical US storefronts per merchant are not reported.',
        publishedAt: null },
    ],
  };
}

export function comparableBuyers(profile: CommercialProfile): { market: ReachableMarket; sources: CommercialSource[] } | undefined {
  const product = matchedUsComparable(profile);
  if (!product) return;
  const estimate = product === 'elevar' ? storefrontEstimate() : companyEstimate(product);
  // Return the cited product evidence used by the shared matcher as well as
  // the new cohort evidence. The caller can remap the whole block together.
  const productSource = profile.sources.find(s => matchedUsComparable({ ...profile, sources: [s] }) === product);
  if (!productSource) return;
  const sources = [...estimate.sources, productSource].map((s, i) => ({ ...s, id: 'B' + (i + 1) }));
  return { market: { ...estimate.market, sourceIds: sources.map(s => s.id) }, sources };
}
