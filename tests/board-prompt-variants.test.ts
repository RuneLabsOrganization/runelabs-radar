import { describe, it, expect } from 'vitest';
import { collapseVariants } from '@/lib/board/sync';
import type { MarketModel } from '@/lib/analytics';

const m = (name: string, intelligence: number): MarketModel => ({
  name,
  org: null,
  intelligence,
  coding: null,
  price: 1,
  priceIn: 1,
  priceOut: 1,
  speed: null,
  released: null,
  source: 'artificial_analysis',
  intelligenceSource: 'aa',
  intelligenceSeededAt: null,
});

describe('collapseVariants', () => {
  it('keeps the best effort setting per model so variants do not crowd the prompt', () => {
    const out = collapseVariants([
      m('Claude Fable 5.2 (High, Default Fallback)', 61.8),
      m('Claude Fable 5.2 (Max, Default Fallback)', 64.6),
      m('Claude Fable 5.2 (Low, Default Fallback)', 53.9),
      m('GPT-6.2 Astra (Max)', 62.1),
      m('DeepSeek V4 Pro', 59),
    ]);
    expect(out.map((x) => x.name)).toEqual([
      'Claude Fable 5.2 (Max, Default Fallback)',
      'GPT-6.2 Astra (Max)',
      'DeepSeek V4 Pro',
    ]);
  });
});
