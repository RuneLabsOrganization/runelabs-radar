import { promptLine } from '../prompt-hygiene';
import { commercialUrl } from './commercial';
import type { Context } from './engine';
import { opportunitySearchProviders } from './research';

const topics = [
  'family caregivers and older adults arranging home care',
  'farmers and food cooperatives handling harvests and spoilage',
  'tenants and tradespeople arranging home repairs',
  'students and families arranging childcare or after-school activities',
  'independent makers and performers earning income from their work',
  'passengers and small transport operators coordinating local travel',
  'households and community groups accessing everyday services',
];

function cleanText(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  return promptLine(text.replace(/<[^>]*>/g, ' ').replace(/[<>\[\]]/g, ' '), max);
}

/** One question per eligible public sweep. Adapters enforce their own search budgets. */
export async function addDemandSignals(ctx: Context, geography: string): Promise<void> {
  const utcDay = Math.floor(Date.now() / 86_400_000);
  const query = `${geography}: surveys or first-hand accounts of unmet needs, delays or costly workarounds for ${topics[utcDay % topics.length]}`;
  for (const search of opportunitySearchProviders()) {
    let hits;
    try {
      hits = await search({ query, count: 4 });
    } catch {
      continue;
    }
    if (!Array.isArray(hits)) continue;
    const lines: string[] = [];
    const urls = new Set<string>();
    for (const hit of hits.slice(0, 4)) {
      if (typeof hit?.url !== 'string') continue;
      const href = commercialUrl(hit.url);
      const title = cleanText(hit.title, 120);
      const snippet = cleanText(hit.description, 300);
      if (!href || urls.has(href) || !title || !snippet) continue;
      urls.add(href);
      const ref = `D${lines.length + 1}`;
      ctx.refMap.set(ref, { type: 'demand', label: title, href });
      lines.push(`[${ref}] ${new URL(href).hostname} · ${title} — ${snippet}`);
    }
    if (lines.length) {
      ctx.blocks += `\n\n<customer-demand-reports>\n${lines.join('\n')}\n</customer-demand-reports>`;
      return;
    }
  }
}
