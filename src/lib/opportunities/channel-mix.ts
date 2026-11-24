import type { CommercialProfile, CommercialSource } from './commercial';
import { matchedUsComparable } from './comparable-product';

type Shares = { favorable: number; base: number; adverse: number };
type Weight = Shares & { channel: string };
type Product = NonNullable<ReturnType<typeof matchedUsComparable>>;

const search = 'US paid search';
const appStore = 'US Shopify App Store search ads';
const attribution = 'US launch scenarios per 100 new paying accounts from modeled routes. Credit each once: sourced referral first, otherwise last paid click. Exclude organic and other routes. ';

const plans: Record<Product, { referral: string; share: Shares; assumptions: string; sources: CommercialSource[] }> = {
  optmyzr: {
    referral: 'PPC agency customer referrals',
    share: { favorable: 35, base: 20, adverse: 10 },
    assumptions: 'In 2014 AgoraPulse reported 10–25% of incoming customers from referrals across all channels, geography undisclosed. For PPC alerts before a broad advocate base exists, assume referrals bring 10% of all new payers and the modeled routes bring 50%: 10/50 = 20% base. Vary peer advocacy from established to sparse for the favorable and adverse cases.',
    sources: [{
      id: 'W1', title: 'Ambassador · AgoraPulse founder on customer acquisition',
      url: 'https://cdn2.hubspot.net/hub/493941/file-2606497127-pdf/Drip_Migration_eBooks/CaseStudy_AgoraPulse.pdf',
      publishedAt: null,
      snippet: 'In this 2014 provider case study, the founder of B2B social CRM AgoraPulse attributed 10–25% of incoming customers to its referral program. The report does not specify the measurement period, billing definition, geography or paid-ad share. Its program mobilized existing customers.',
    }],
  },
  elevar: {
    referral: 'Shopify implementation agency referrals',
    share: { favorable: 50, base: 33, adverse: 15 },
    assumptions: 'Constant Contact H1 2007: 15% partners / (15% partners + 31% online ads) ≈ 33% of those new customers. Includes resellers and banner ads; no US-only mix. Octane AI cites partners for most top customers. Assume strong/new agency coverage at 50%/15%. Split remaining payers assuming equal all-in budgets for App Store and web search: payer counts follow inverse scenario CAC. No observed Elevar split.',
    sources: [{
      id: 'W2', title: 'Constant Contact · Prospectus, customer acquisition sources',
      url: 'https://www.sec.gov/Archives/edgar/data/1405277/000095013507005986/b65345b4e424b4.htm',
      publishedAt: '2007-10-02T00:00:00.000Z',
      snippet: 'In H1 2007 channel partners generated about 15% and online ads 31% of all new email marketing customers. Partners included agencies, web designers and larger distributors. Online spend included search and banners. These company-wide data predate the Shopify App Store.',
    }, {
      id: 'W3', title: 'Octane AI · Cofounder Ben Parr on Shopify agency and technology partners',
      url: 'https://www.slideshare.net/slideshow/7-steps-to-building-and-growing-an-incredible-partner-program-for-saas-startups-and-agencies-130821857/130821857',
      publishedAt: null,
      snippet: 'Discussing 2018 growth, Parr attributed most top customers to agency and technology partners together. The separately reported 40% agency contribution measures revenue. The deck provides neither an all-new-paying-store share nor a US split. Octane signed over 50 agencies in its first three program months.',
    }],
  },
  voluum: {
    referral: 'Affiliate publisher referrals',
    share: { favorable: 50, base: 30, adverse: 15 },
    assumptions: 'FirstPromoter reported in Nov 2026 that affiliates sourced about 15% of neuroflash’s new customers across all routes, geography undisclosed. Assume that share and 50% modeled-route coverage: 15/50 = 30% base. Publisher audiences fit affiliate tracking, but neuroflash already had an active program. Model stronger publisher activation at 50%, sparse launch coverage at 15%.',
    sources: [{
      id: 'W4', title: 'FirstPromoter · Affiliate program management and neuroflash customer acquisition',
      url: 'https://firstpromoter.com/blog/affiliate-program-management',
      publishedAt: '2026-11-23T00:00:00.000Z',
      snippet: 'FirstPromoter reports that about 15% of new customers at neuroflash, a content software company, arrive via affiliates. This customer interview figure is distinct from the report’s multi-program promoter activation statistics. No US subset or fraction acquired through paid search is given.',
    }],
  },
};

export function comparableMix(profile: CommercialProfile):
  { weights: Weight[]; assumptions: string; sources: CommercialSource[] } | undefined {
  const product = matchedUsComparable(profile);
  if (!product || !profile.cacChannels) return;
  const plan = plans[product];
  const byChannel = new Map(profile.cacChannels.map(c => [c.channel, c]));
  const expected = product === 'elevar' ? [appStore, search, plan.referral] : [search, plan.referral];
  if (profile.cacChannels.length !== expected.length || !expected.every(name => byChannel.has(name))) return;

  const referrals = { channel: plan.referral, ...plan.share };
  const web = { channel: search, favorable: 100 - referrals.favorable, base: 100 - referrals.base, adverse: 100 - referrals.adverse };
  const weights = product === 'voluum' ? [referrals, web] : [web, referrals];
  if (product === 'elevar') {
    const marketplace = { channel: appStore, favorable: 0, base: 0, adverse: 0 };
    const storeCost = byChannel.get(appStore)!.usd;
    const webCost = byChannel.get(search)!.usd;
    for (const [scenario, cost] of [['favorable', 'low'], ['base', 'base'], ['adverse', 'high']] as const) {
      if (!(Number.isFinite(storeCost[cost]) && storeCost[cost] > 0 && Number.isFinite(webCost[cost]) && webCost[cost] > 0)) return;
      // Equal dollars per paid route imply payers proportional to 1 / CAC.
      // Round one route only so all three integer percentages sum to 100.
      marketplace[scenario] = Math.round(web[scenario] / (1 + storeCost[cost] / webCost[cost]));
      web[scenario] -= marketplace[scenario];
    }
    weights.unshift(marketplace);
  }
  return { weights, assumptions: attribution + plan.assumptions, sources: plan.sources.map(s => ({ ...s })) };
}
