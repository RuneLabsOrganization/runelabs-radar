import type { CommercialProfile } from './commercial';

type Product = 'optmyzr' | 'elevar' | 'voluum';

/** Match a product's function, economic buyer and cited publisher in the US dossier. */
export function matchedUsComparable(p: CommercialProfile): Product | undefined {
  if (!/^(?:united states(?: of america)?|u\.?s\.?(?:a\.?)?)$/i.test(p.geography.trim())) return;
  const payer = p.payer ?? '';
  const segment = [p.industry, p.user, payer].join(' ');
  const matches = new Set<Product>();
  for (const c of p.competition ?? []) {
    const name = c.name.toLowerCase().trim();
    for (const id of c.sourceIds) {
      const source = p.sources.find(s => s.id === id);
      if (!source || !URL.canParse(source.url)) continue;
      const url = new URL(source.url);
      const host = url.hostname.replace(/^www\./, '');
      if (name === 'optmyzr' && host === 'optmyzr.com' && /agenc(?:y|ies)/i.test(payer) &&
          /\b(?:ppc|advertising|paid search|paid media)\b/i.test(segment)) matches.add('optmyzr');
      if (/^elevar(?: by audiense)?$/.test(name) && (host === 'getelevar.com' ||
          (host === 'apps.shopify.com' && url.pathname.replace(/\/$/, '') === '/gtm-datalayer-by-elevar')) &&
          /merchant|store|retailer|brand/i.test(payer) && /shopify/i.test(segment)) matches.add('elevar');
      if (name === 'voluum' && host === 'voluum.com' && /affiliate|media.buy/i.test(payer) &&
          /affiliate/i.test(segment)) matches.add('voluum');
    }
  }
  if (matches.size === 1) return [...matches][0];
}
