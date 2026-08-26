import { describe, it, expect } from 'vitest';
import { matchPricedEntity, stripQualifier } from '@/lib/kits/match-price';

/** Real provider-pricing entities from production. */
const PRICED = [
  'Claude Opus 5',
  'Claude Sonnet 4.5',
  'DeepSeek-V4',
  'DeepSeek-R2',
  'GPT-5.5',
  'GPT-5.5 mini',
  'Gemini 3 Flash',
  'Gemini 3 Pro',
  'Kimi K3',
  'Kimi K3 Turbo',
  'MiniMax-M2',
  'Qwen4-Max',
  'Qwen4-Plus',
];

describe('stripQualifier', () => {
  it('drops a trailing effort/quantisation parenthetical', () => {
    expect(stripQualifier('Claude Opus 5 (Adaptive Reasoning, Max Effort)')).toBe('Claude Opus 5');
    expect(stripQualifier('Ideogram 4 (INT8)')).toBe('Ideogram 4');
    expect(stripQualifier('GPT-5.6 Sol (max)')).toBe('GPT-5.6 Sol');
  });

  it('drops a "via <runtime>" suffix', () => {
    expect(stripQualifier('Qwen3.8-27B via Ollama')).toBe('Qwen3.8-27B');
    expect(stripQualifier('Stable Diffusion 3.5 Medium via ComfyUI')).toBe('Stable Diffusion 3.5 Medium');
  });

  it('leaves an unqualified name alone', () => {
    expect(stripQualifier('Kimi K3')).toBe('Kimi K3');
  });

  // A parenthetical containing "via" marks a different runtime/deployment,
  // not an effort tier — stripping it would collapse a free local run onto
  // the hosted API product's name and inherit its price.
  it('does NOT strip a parenthetical that names a self-hosted runtime', () => {
    expect(stripQualifier('Ideogram 4 (INT8 via ComfyUI)')).toBe('Ideogram 4 (INT8 via ComfyUI)');
    expect(stripQualifier('Krea2 Turbo (INT4 via ComfyUI-INT4-Fast)')).toBe(
      'Krea2 Turbo (INT4 via ComfyUI-INT4-Fast)',
    );
  });
});

describe('matchPricedEntity', () => {
  it('matches once the qualifier is stripped', () => {
    expect(matchPricedEntity('Claude Opus 5 (Adaptive Reasoning, Max Effort)', PRICED)).toBe('Claude Opus 5');
  });

  it('matches an exact name', () => {
    expect(matchPricedEntity('Kimi K3', PRICED)).toBe('Kimi K3');
  });

  // The whole point of exact matching. Each of these would be resolved WRONG
  // by a prefix or contains match, asserting a price for a different model.
  it.each([
    ['GPT-5.6 Sol (max)', 'GPT-5.5'],
    ['GPT-5.6 Terra (max)', 'GPT-5.5'],
    ['Gemini 3.7 Flash (high)', 'Gemini 3 Flash'],
    ['Claude Sonnet 5', 'Claude Sonnet 4.5'],
    ['DeepSeek V4 Pro (Reasoning, Max Effort)', 'DeepSeek-V4'],
  ])('refuses the near-miss %s -> %s', (pick) => {
    expect(matchPricedEntity(pick, PRICED)).toBeNull();
  });

  it('does not match a more specific priced variant', () => {
    // "Kimi K3" must not grab "Kimi K3 Turbo"'s price, nor the reverse
    expect(matchPricedEntity('Kimi K3', ['Kimi K3 Turbo'])).toBeNull();
  });

  it('returns null for local/unpurchasable picks', () => {
    expect(matchPricedEntity('Qwen3.8-27B via Ollama', PRICED)).toBeNull();
    expect(matchPricedEntity('barebrowse + local model', PRICED)).toBeNull();
    expect(matchPricedEntity('agent-skills (Addy Osmani)', PRICED)).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(matchPricedEntity('', PRICED)).toBeNull();
    expect(matchPricedEntity('(max)', PRICED)).toBeNull();
  });

  // The exact production hazard: a hosted pick and its free local-run sibling
  // must never share a price just because the local run collapsed onto the
  // hosted name.
  it('never prices a self-hosted variant off the hosted product name', () => {
    expect(matchPricedEntity('Ideogram 4 (INT8 via ComfyUI)', ['Ideogram 4'])).toBeNull();
    expect(matchPricedEntity('Ideogram 4', ['Ideogram 4'])).toBe('Ideogram 4'); // the hosted pick still matches
  });
});
