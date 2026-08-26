/**
 * The kit grid — jobs × cost tiers.
 *
 * Deliberately decoupled from src/lib/domains.ts DOMAINS. Story curation keeps
 * its six scoring buckets; the kit grid grows independently (audio, infra,
 * connectors) without touching domain_scores, source hints or hub colours.
 */

export const KIT_CATEGORIES = [
  'coding', 'agentic', 'copy', 'image', 'video', 'ads', 'audio', 'infra', 'connectors',
] as const;
export type KitCategory = (typeof KIT_CATEGORIES)[number];

export const KIT_TIERS = ['best', 'value', 'cheapest'] as const;
export type KitTier = (typeof KIT_TIERS)[number];

export interface KitCell {
  category: KitCategory;
  task: string;
}

export const KIT_GRID: Record<KitCategory, readonly string[]> = {
  coding: ['agentic-coding', 'autocomplete', 'code-review'],
  agentic: ['orchestration', 'browser-automation', 'computer-use'],
  copy: ['long-form', 'social', 'ad-copy'],
  image: ['illustration', 'photoreal', 'product-shots'],
  video: ['text-to-video', 'image-to-video', 'avatar'],
  ads: ['creative-generation', 'campaign-management'],
  audio: ['voice-tts', 'music', 'transcription'],
  infra: ['hosting', 'database-baas', 'auth', 'payments'],
  connectors: ['code-repo', 'data', 'browser', 'design'],
};

export const KIT_CATEGORY_LABELS: Record<KitCategory, string> = {
  coding: 'Coding',
  agentic: 'Agentic',
  copy: 'Copy',
  image: 'Image',
  video: 'Video',
  ads: 'Ads',
  audio: 'Audio',
  infra: 'Infrastructure',
  connectors: 'Connectors',
};

export function isKitCategory(s: string): s is KitCategory {
  return (KIT_CATEGORIES as readonly string[]).includes(s);
}

export function isKitTier(s: string): s is KitTier {
  return (KIT_TIERS as readonly string[]).includes(s);
}

export function isKitCell(category: string, task: string): boolean {
  if (!isKitCategory(category)) return false;
  return KIT_GRID[category].includes(task);
}

/** Every cell in the grid, category order then task order. */
export function allCells(): KitCell[] {
  return KIT_CATEGORIES.flatMap((category) =>
    KIT_GRID[category].map((task) => ({ category, task })),
  );
}

export function cellKey(category: string, task: string, tier: string): string {
  return `${category}/${task}/${tier}`;
}
