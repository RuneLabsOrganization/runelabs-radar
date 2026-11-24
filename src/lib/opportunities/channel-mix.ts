import type { CommercialProfile, CommercialSource } from './commercial';
import { founderPilotPayers } from './channel-cac';
import { matchedUsComparable } from './comparable-product';

type Shares = { favorable: number; base: number; adverse: number };
type Weight = Shares & { channel: string };
type Product = NonNullable<ReturnType<typeof matchedUsComparable>>;

const search = 'US paid search';
const appStore = 'US Shopify App Store search ads';
const organic = 'US organic inbound';
const outbound = 'US founder-led outbound';
const launchPayers = 10;
const totalBps = 10_000;
const attribution = 'First 10 US payers if reached. Credit first source once. Each 90-day pilot contributes its expected payers from unpaid guides or 300 cold emails. One base email win takes ~1,961 contacts/~162h. Assume only listed routes. Ads and referrals fill the balance. ';

const plans: Record<Product, { referral: string; share: Shares; assumptions: string; sources: CommercialSource[] }> = {
  optmyzr: {
    referral: 'PPC agency customer referrals',
    share: { favorable: 35, base: 20, adverse: 10 },
    assumptions: 'Boston PPC vendor WordStream closed 40% of phone demos in seven days company-wide. A grader lead closed by phone retains its original source. Assume 35/20/10% of remaining payers via active agency advocates as adoption varies; search fills the rest. US launch shares are estimates.',
    sources: [{
      id: 'W5', title: 'WordStream founder Larry Kim · PPC acquisition and sales-assisted demos',
      url: 'https://mixergy.com/interviews/wordstream-with-larry-kim/',
      publishedAt: '2019-01-16T00:00:00.000Z',
      snippet: 'The Boston PPC software founder described an AdWords account grader as a lead source, about one-third of customers coming from older leads, and 40% of prospects on the phone buying within seven days. These are company-wide lead and close metrics. They do not identify organic traffic, cold-email wins, or first-ten US payer shares.',
    }],
  },
  elevar: {
    referral: 'Shopify implementation agency referrals',
    share: { favorable: 50, base: 33, adverse: 15 },
    assumptions: 'Elevar’s 10k early guide reads included promotion; unpaid store discovery is outside this plan. Constant Contact’s company-wide 15% partner / (15% + 31% online ads) anchors 33% of residual payers; assume 50/15% with strong/weak agencies. Equal paid budgets imply inverse-CAC store/web shares.',
    sources: [{
      id: 'W2', title: 'Constant Contact · Prospectus, customer acquisition sources',
      url: 'https://www.sec.gov/Archives/edgar/data/1405277/000095013507005986/b65345b4e424b4.htm',
      publishedAt: '2007-10-02T00:00:00.000Z',
      snippet: 'In H1 2007 channel partners generated about 15% and online ads 31% of all new email marketing customers. Partners included agencies, web designers and larger distributors. Online spend included search and banners. These company-wide data predate the Shopify App Store.',
    }, {
      id: 'W6', title: 'Elevar founder Brad Redding · Prelaunch Shopify analytics guides',
      url: 'https://encharge.io/pre-launch-marketing/',
      publishedAt: '2021-10-22T00:00:00.000Z',
      snippet: 'Charleston-based Elevar reported 10,000 reads in its first six months publishing analytics guides and opinion pieces. It also boosted articles on Facebook and struggled to collect emails on Medium. This is company-wide readership with no US, unpaid-only, or paying-store breakdown. The guide pilot excludes marketplace browsing.',
    }],
  },
  voluum: {
    referral: 'Affiliate publisher referrals',
    share: { favorable: 50, base: 30, adverse: 15 },
    assumptions: 'Everflow’s first two payers came via a Las Vegas booth; later beta contacts converted. Neither proves cold-email yield or US billing. Assume activated publishers bring 50/30/15% of residual tracker payers as reach varies; paid search fills the rest. No booth or warm-contact sales assumed.',
    sources: [{
      id: 'W7', title: 'Everflow CEO Sam Darawish · Finding the first ten tracking customers',
      url: 'https://saasclub.io/podcast/everflow-sam-darawish-459/',
      publishedAt: null,
      snippet: 'In episode 459 (2025) the US-based affiliate tracking founder describes two paying customers from a roughly $5k–$6k Las Vegas booth and further conversions from people contacted during six to seven months of product research. The event was in the US; customer geography and the complete first-ten split were undisclosed. The booth and warm beta follow-ups are separate from cold email.',
    }, {
      id: 'W8', title: 'Everflow · Company history and referral-led growth',
      url: 'https://www.everflow.io/about-us',
      publishedAt: null,
      snippet: 'Founded in 2016 by former affiliate network operators, Everflow attributes growth to satisfied customers and referrals. Its founders already knew the industry. This company-wide account supports testing a publisher route, but gives no publisher-attributed payer percentage for an unproven US launch.',
    }],
  },
};

export function comparableMix(profile: CommercialProfile):
  { weights: Weight[]; assumptions: string; sources: CommercialSource[] } | undefined {
  const product = matchedUsComparable(profile);
  if (!product || !profile.cacChannels) return;
  const plan = plans[product];
  const byChannel = new Map(profile.cacChannels.map(c => [c.channel, c]));
  const expected = [search, plan.referral, organic, outbound];
  if (product === 'elevar') expected.unshift(appStore);
  if (profile.cacChannels.length !== expected.length || !expected.every(name => byChannel.has(name))) return;

  // Allocate integer basis points until every route has its share.
  const guideWeight = { channel: organic, favorable: 0, base: 0, adverse: 0 };
  const emailWeight = { channel: outbound, favorable: 0, base: 0, adverse: 0 };
  const referrals = { channel: plan.referral, favorable: 0, base: 0, adverse: 0 };
  const web = { channel: search, favorable: 0, base: 0, adverse: 0 };
  const pilots = founderPilotPayers();
  for (const s of ['favorable', 'base', 'adverse'] as const) {
    guideWeight[s] = Math.round(pilots.organic[s] * (totalBps / launchPayers));
    emailWeight[s] = Math.round(pilots.outbound[s] * (totalBps / launchPayers));
    const remaining = totalBps - guideWeight[s] - emailWeight[s];
    referrals[s] = Math.round(remaining * plan.share[s] / 100);
    web[s] = remaining - referrals[s];
  }
  const weights = product === 'voluum' ? [referrals, web] : [web, referrals];
  if (product === 'elevar') {
    const marketplace = { channel: appStore, favorable: 0, base: 0, adverse: 0 };
    const storeCost = byChannel.get(appStore)!.usd;
    const webCost = byChannel.get(search)!.usd;
    for (const [scenario, cost] of [['favorable', 'low'], ['base', 'base'], ['adverse', 'high']] as const) {
      if (!(Number.isFinite(storeCost[cost]) && storeCost[cost] > 0 && Number.isFinite(webCost[cost]) && webCost[cost] > 0)) return;
      // Equal dollars per paid route imply payers proportional to 1 / CAC.
      // Assign the remaining basis points to web search.
      marketplace[scenario] = Math.round(web[scenario] / (1 + storeCost[cost] / webCost[cost]));
      web[scenario] -= marketplace[scenario];
    }
    weights.unshift(marketplace);
  }
  weights.push(guideWeight, emailWeight);
  return {
    weights: weights.map(({ channel, favorable, base, adverse }) => ({
      channel, favorable: favorable / 100, base: base / 100, adverse: adverse / 100,
    })),
    assumptions: attribution + plan.assumptions,
    sources: plan.sources.map(s => ({ ...s })),
  };
}
