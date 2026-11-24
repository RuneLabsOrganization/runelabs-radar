import { DEFAULT_UA, stripHtml } from '../ingest/adapters/shared';
import { promptLine } from '../prompt-hygiene';
import { commercialUrl, type CommercialSource } from './commercial';
import type { OppDraft } from './engine';

// These URLs nominate candidates. The cited description must come from the current page.
const products = [
  { name: 'Voluum', url: 'https://voluum.com/',
    match: [/\baffiliates?\b/i, /\b(?:paid[ -]traffic|attribution|track(?:s|ed|ing|ers?)?|conversions?)\b/i],
    feature: /\bad track(?:ing|er)\b|\bconversion attribution\b/i },
  { name: 'Elevar', url: 'https://apps.shopify.com/gtm-datalayer-by-elevar',
    match: [/\bshopify\b/i, /conversion|attribution|data[ -]?layer|tracking pixel|GA4/i], feature: /conversion|server.side tracking/i },
  { name: 'DebugBear', url: 'https://www.debugbear.com/',
    match: [/web performance|website performance|page[ -]?speed|site speed|core web vitals|largest contentful paint|lighthouse scores?/i], feature: /performance|page speed|web vitals/i },
  { name: 'CallRail', url: 'https://www.callrail.com/call-tracking',
    alternate: 'https://wordpress.org/plugins/callrail-phone-call-tracking/',
    match: [/call[ -](?:tracking|attribution)|track(?:ing)? (?:phone |inbound )?calls|phone lead attribution|dynamic number insertion/i],
    feature: /calls?|phone numbers|number insertion/i },
  { name: 'Better Reports', url: 'https://apps.shopify.com/betterreports',
    match: [/\bshopify\b/i, /\banalytics|\breports?\b|\breporting\b|\bdashboards?\b|\bmetrics\b/i], feature: /reports?|analytics/i },
  { name: 'Percy', url: 'https://www.browserstack.com/percy',
    match: [/\bweb(?:site)?\b|\bbrowser\b|\bvisual\b|\bUI\b/i, /\bQA\b|\btesting\b|\bregressions?\b|\bscreenshot diff/i], feature: /visual test|screenshot/i },
  { name: 'Optmyzr', url: 'https://www.optmyzr.com/',
    match: [/\bPPC\b|pay.per.click|paid search|google ads/i, /agenc|campaign|management|report|optimi[sz]|audit/i], feature: /campaign|\bPPC\b|paid search/i },
  { name: 'Apollo Data', url: 'https://www.apollo.io/product/b2b-data',
    match: [/lead[ -]gen(?:eration)?\b|sales prospect|contact enrichment|outbound sales/i], feature: /contact|prospect|sales intelligence/i },
  { name: 'Farmbrite', url: 'https://www.farmbrite.com/',
    match: [/\bfarm|\bcrop|\blivestock/i, /record.keeping|management|tracking|planning/i], feature: /farm|crop|livestock/i },
];

type Candidate = Omit<CommercialSource, 'id'>;

// All requests go to fixed publisher/API endpoints. Bound body bytes as well as
// wall time; following a redirect would lose the first-party provenance.
async function readPrefix(url: string, accept: string): Promise<string> {
  const response = await fetch(url, {
    redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Accept: accept, 'User-Agent': DEFAULT_UA },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return '';
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let remaining = accept === 'text/html' ? 768 * 1024 : 192 * 1024;
  let text = '';
  try {
    while (remaining > 0) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.subarray(0, remaining);
      text += decoder.decode(part, { stream: true });
      remaining -= part.length;
      if (accept === 'text/html' && /<\/head>/i.test(text)) break;
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel();
  }
}

async function productSource(product: typeof products[number]): Promise<Candidate[]> {
  for (const url of [product.url, product.alternate]) {
    if (!url) continue;
    const html = await readPrefix(url, 'text/html').catch(() => '');
    const title = stripHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    if (!title.toLowerCase().includes(product.name.toLowerCase())) continue;
    for (const [meta] of html.matchAll(/<meta\s[^>]+>/gi)) {
      if (!/\s(?:name|property)\s*=\s*["']?(?:og:)?description(?:["'\s/>])/i.test(meta)) continue;
      const attr = /\scontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(meta);
      const snippet = promptLine(stripHtml(attr?.[1] ?? attr?.[2] ?? ''), 480);
      if (product.feature.test(snippet)) return [{ url, title: product.name, snippet, publishedAt: null }];
    }
  }
  return [];
}

function appleCountry(geography: string) {
  const geo = geography.trim().toLowerCase();
  if (/^(united states( of america)?|usa|u\.s\.(a\.)?)$/.test(geo)) return 'us';
  if (geo === 'uk') return 'gb';
  if (/^[a-z]{2}$/.test(geo)) return geo;
  const regions = new Intl.DisplayNames(['en'], { type: 'region' });
  return 'us ca gb br fr de au nz in mx jp es it nl se dk no ie kr sg za ch at be ar cl co pt pl fi il tr id my ph ae sa'.split(' ')
    .find(code => regions.of(code.toUpperCase())?.toLowerCase() === geo);
}

async function appSources(task: string, geo: string): Promise<Candidate[]> {
  const country = appleCountry(geo);
  if (!country) return [];
  const generic = /^(?:iphone|ipad|ios|mobile|apps?|for|the|and|with|from|that|users?|track|manage|platform)$/;
  const keywords = [...new Set(task.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter(w => !generic.test(w)).slice(0, 5);
  if (keywords.length < 2) return [];
  const params = new URLSearchParams({ country, entity: 'software', term: keywords.join(' '), limit: '5' });
  const body = await readPrefix('https://itunes.apple.com/search?' + params, 'application/json');
  const records = JSON.parse(body).results;
  if (!Array.isArray(records)) return [];
  const sources: Candidate[] = [];
  for (const app of records.slice(0, 5)) {
    if (app?.kind !== 'software' || !Number.isSafeInteger(app.trackId) ||
        typeof app.trackName !== 'string' || typeof app.description !== 'string') continue;
    const safe = commercialUrl(app.trackViewUrl);
    if (!safe) continue;
    const url = new URL(safe);
    if (url.origin !== 'https://apps.apple.com' || !new RegExp(`^/${country}/app/(?:[^/]+/)?id${app.trackId}/?$`).test(url.pathname)) continue;
    const title = promptLine(stripHtml(app.trackName), 160);
    const snippet = promptLine(stripHtml(app.description), 480);
    const tokens = new Set((title + ' ' + snippet).toLowerCase().match(/[\p{L}\p{N}]+/gu));
    if (title && snippet && keywords.filter(w => tokens.has(w)).length >= 2) {
      sources.push({ title, snippet, url: url.origin + url.pathname, publishedAt: null });
    }
  }
  return sources;
}

/** Two candidate products (CallRail has one alternate listing) and at most one Apple query. */
export async function competitorSources(d: Pick<OppDraft, 'title' | 'researchTarget'>, geo: string): Promise<CommercialSource[]> {
  const topic = [d.title, d.researchTarget?.task].filter(Boolean).join(' ');
  const requests = products.filter(p => p.match.every(pattern => pattern.test(topic))).slice(0, 2).map(productSource);
  if (/\b(?:iOS|iPhone|iPad|mobile app)\b/i.test(topic)) {
    requests.push(appSources(d.researchTarget?.task || d.title, geo));
  }
  const found = new Map<string, Candidate>();
  for (const result of await Promise.allSettled(requests)) {
    if (result.status === 'fulfilled') {
      for (const source of result.value) found.set(source.url, source);
    }
  }
  return [...found.values()].slice(0, 4).map((s, i) => ({ ...s, id: 'V' + (i + 1) }));
}
