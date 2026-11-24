import type { CommercialProfile, CommercialSource } from './commercial';
import { matchedUsComparable } from './comparable-product';

type Channel = {
  channel: string;
  usd: { low: number; base: number; high: number };
  assumptions: string;
  sourceIds: string[];
};
type Product = NonNullable<ReturnType<typeof matchedUsComparable>>;

// IDs are local to this result; the persistence layer remaps them on merge.
const evidence: CommercialSource[] = [
  { id: 'C1', title: 'LocaliQ / WordStream · 2026 search advertising benchmarks',
    url: 'https://www.wordstream.com/blog/2026-google-ads-benchmarks', publishedAt: '2026-05-18T00:00:00.000Z',
    snippet: 'Business Services median CPC was USD 5.87. Across industries the study covered 13,474 US Google and Microsoft search campaigns, April 2025–March 2026. The category does not isolate PPC agencies, tracking tools or newly paying customers.' },
  { id: 'C2', title: 'US Bureau of Labor Statistics · June 2026 employer compensation, Table 4',
    url: 'https://www.bls.gov/news.release/archives/ecec_09092026.htm', publishedAt: '2026-09-09T00:00:00.000Z',
    snippet: 'US private professional and business services employers paid an average of USD 59.80 in wages and benefits per hour worked in June 2026. Used as a labor budget proxy across roles. Actual founder, sales and support costs can differ.' },
  { id: 'C3', title: 'Optmyzr · Affiliate program for active customers',
    url: 'https://help.optmyzr.com/en/articles/6025204-optmyzr-s-affiliate-program', publishedAt: '2026-01-06T00:00:00.000Z',
    snippet: 'Active Optmyzr customers can join its global program. A qualified paid referral earns 10% of subscription fees while subscribed. Trial signups alone do not earn commission. This is a program design comparable without US conversion or retention data.' },
  { id: 'C4', title: 'Voluum · Referral program rates',
    url: 'https://voluum.com/referral-program/', publishedAt: null,
    snippet: 'Voluum advertises commissions up to 10% on referred subscriptions. Noncustomers can apply as referrers. Program page reviewed November 2026. It gives no US acquisition funnel or acquisition cost.' },
  { id: 'C5', title: 'Voluum · Tracker referral program terms, sections 1 and 3',
    url: 'https://voluum.com/referral-program-terms-and-conditions/', publishedAt: '2024-01-01T00:00:00.000Z',
    snippet: 'The Polish operator requires a new unrelated account and successful payment. Monthly-plan commission is capped at USD 105 per referred account per month. Long-term plans have different rules. The terms do not establish US CAC.' },
  { id: 'C6', title: 'Shopify · App Store search ads and country targeting',
    url: 'https://shopify.dev/docs/apps/launch/marketing/advertising/create-ads', publishedAt: null,
    snippet: 'Shopify supports keyword search ads for listed apps with country targeting, USD budgets and per-click bids. A developer can limit delivery to US merchants. Documentation reviewed November 2026. The auction does not promise a cost per install or payer.' },
  { id: 'C7', title: 'Convert2x · Shopify App Store ads case study, case 2',
    url: 'https://convert2x.com/learn/shopify-app-case-studies', publishedAt: null,
    snippet: 'In one agency-managed account, suggested keywords cost $3.58 per install versus $9.98 for the comparison campaign. Case collection updated October 2026. Country mix, app category, observation dates and subsequent paid conversions were undisclosed.' },
  { id: 'C8', title: 'Analyzify · Agency partner tiers for Shopify tracking',
    url: 'https://analyzify.com/partner-tiers', publishedAt: null,
    snippet: 'This comparable Shopify analytics provider lists 10% recurring commission at entry level and 10–30% across tiers based on active stores. This is Analyzify’s schedule. Elevar’s rate and US partner conversion are unknown. Reviewed November 2026.' },
  { id: 'C9', title: 'ChartMogul / ProductLed · The Conversion Report',
    url: 'https://chartmogul.com/reports/saas-conversion-report/', publishedAt: '2026-02-04T00:00:00.000Z',
    snippet: 'January 2026 survey of 200 software products. The free-trial funnel shows 4.5% of website visitors starting trials and 8% of trial signups becoming paying customers within six months. These self-reported benchmarks span traffic channels. Geography and a US paid-search conversion rate are undisclosed.' },
];

const laborUsd = 59.80;
const cents = (n: number) => Math.round(n * 100) / 100;

function paidSearch(product: Product): Channel {
  const cpc = 5.87;
  const basePayingShare = 0.045 * 0.08;
  const cost = (payingShare: number) => cents(cpc / payingShare + 1.5 * laborUsd);
  return {
    channel: 'US paid search',
    usd: { low: cost(2 * basePayingShare), base: cost(basePayingShare), high: cost(basePayingShare / 2) },
    assumptions: (product === 'optmyzr' ? 'Primary for PPC agencies seeking tools before a referral base exists. ' : '') +
      'Assume one US paid click yields one landing visit. Survey funnel: 4.5% of visitors start a trial × 8% pay within six months of signup = 0.36%. Cross-channel proxy; geography unknown, US paid-search conversion unmeasured. Low/base/high CAC = $5.87 US Business Services CPC ÷ 0.72%/0.36%/0.18% (double/base/half conversion) + 1.5h × $59.80 per new payer for campaign work, sales and onboarding in every case. Excludes fixed tooling and ongoing support.',
    sourceIds: ['C1', 'C2', 'C9'],
  };
}

function shopifyAds(): Channel {
  const cost = (cpi: number, payingShare: number, hours: number) => cents(cpi / payingShare + hours * laborUsd);
  return {
    channel: 'US Shopify App Store search ads',
    usd: { low: cost(3.58, 0.10, 0.5), base: cost(9.98, 0.05, 1), high: cost(19.96, 0.02, 2) },
    assumptions: 'Primary for an approved public app reaching US merchants at install intent. Per new paying store within 30 days: $3.58/$9.98/$19.96 per ad install ÷ assumed 10%/5%/2% install-to-first-payment + 0.5/1/2 hours × $59.80 for ads, sales and onboarding per payer. First two install costs are from one Oct 2026 case with unknown geography; high stresses 2× $9.98. CPI already includes clicks. Excludes listing development, billing fees and ongoing support.',
    sourceIds: ['C6', 'C7', 'C2'],
  };
}

function referrals(product: Product, price: number): Channel {
  const plans = {
    optmyzr: { channel: 'PPC agency customer referrals', sourceIds: ['C3', 'C2'],
      basis: 'Assumes active agency customers to refer peers. Mirror Optmyzr’s global 10% while subscribed.' },
    elevar: { channel: 'Shopify implementation agency referrals', sourceIds: ['C8', 'C2'],
      basis: 'Use Analyzify’s entry-tier 10% recurring agency commission as a proxy for a new Shopify tracking app. Elevar terms unknown.' },
    voluum: { channel: 'Affiliate publisher referrals', sourceIds: ['C4', 'C5', 'C2'],
      basis: 'Primary for publishers who already refer tools to media buyers. Use Voluum’s advertised ceiling of 10%, capped at $105/month on monthly plans.' },
  };
  const plan = plans[product];
  const fee = product === 'voluum' ? Math.min(price * 0.10, 105) : price * 0.10;
  const cost = (months: number, intros: number) => cents(fee * months + (intros * 0.25 + 0.5) * laborUsd);
  return {
    channel: plan.channel,
    usd: { low: cost(3, 2), base: cost(9, 4), high: cost(24, 10) },
    assumptions: plan.basis + ' US scenario per new paying account. Assume $' + price +
      '/month commissionable receipts × 10%' + (product === 'voluum' ? ' (max $105/month)' : '') +
      ' × 3/9/24 lifetime paid months. Assume 2/4/10 qualified US intros per first payment within 30 days. Add (intros × 0.25h partner ops/sales + 0.5h onboarding) × $59.80. Terms are proxies; tenure, conversion and hours are assumptions. Excludes partner launch costs and ongoing support.',
    sourceIds: plan.sourceIds,
  };
}

/** Standalone routes to one first payment. The caller uses the first as primary; never sum channels. */
export function comparableChannels(profile: CommercialProfile, priceUsd: number | null):
  { channels: Channel[]; sources: CommercialSource[] } | undefined {
  const product = matchedUsComparable(profile);
  if (!product) return;
  const channels: Channel[] = [];
  // Fixed distribution fit: Shopify marketplace intent, affiliate distribution
  // for trackers, search for PPC tools before there is an active advocate base.
  if (product === 'elevar') channels.push(shopifyAds());
  const canPrice = priceUsd !== null && Number.isFinite(priceUsd) && priceUsd > 0 && priceUsd <= Number.MAX_SAFE_INTEGER / 1000;
  if (product === 'voluum' && canPrice) channels.push(referrals(product, priceUsd));
  channels.push(paidSearch(product));
  if (product !== 'voluum' && canPrice) channels.push(referrals(product, priceUsd));
  const used = new Set(channels.flatMap(c => c.sourceIds));
  return { channels, sources: evidence.filter(s => used.has(s.id)).map(s => ({ ...s })) };
}
