import { describe, it, expect } from 'vitest';
import { matchesPick } from '@/lib/kits/evidence';

describe('matchesPick — how a reported tool name finds its kit pick', () => {
  it.each([
    // the exact names that used to be the ONLY thing that matched
    ['Stripe', 'Stripe'],
    ['better auth', 'Better Auth'],
    // qualifiers the pick carries but a redditor never types
    ['Claude Opus 5 (Adaptive Reasoning, Max Effort)', 'Claude Opus 5'],
    ['Qwen3.8-27B via Ollama', 'Qwen3.8-27B'],
    ['Ideogram 4 (INT8 via ComfyUI)', 'Ideogram 4'],
    ['Stable Diffusion 3.5 Medium + ControlNet', 'Stable Diffusion 3.5 Medium'],
    ['barebrowse + MiniMax-M2', 'barebrowse'],
    // the vendor in parentheses is the brand people say
    ['HeyGen Video 1 (HeyGen)', 'HeyGen'],
    // product family without the version
    ['Ideogram 4', 'Ideogram'],
    ['Wan 2.7 (Alibaba)', 'Wan'],
    ['Claude Sonnet 5', 'Claude Sonnet'],
    // punctuation and spacing noise
    ['MAI-Image-2.6', 'MAI Image 2.6'],
    ['GPT Image 2.5 Sunburst (max)', 'gpt image 2.5 sunburst'],
  ])('%s ← %s', (pick, tool) => {
    expect(matchesPick(pick, tool)).toBe(true);
  });

  it.each([
    // a bare family name must not pick a tier
    ['Claude Sonnet 5', 'Claude'],
    ['Claude Opus 5 (Adaptive Reasoning, Max Effort)', 'Claude Code'],
    ['GPT Image 2.5 Sunburst (max)', 'GPT'],
    // a different version is a different tool
    ['Ideogram 4', 'Ideogram 3'],
    ['Claude Sonnet 5', 'Claude Sonnet 4.6'],
    ['Wan 2.7 (Alibaba)', 'Alibaba'],
    ['GitHub', 'GitLab'],
    ['Stripe', ''],
  ])('%s ✗ %s', (pick, tool) => {
    expect(matchesPick(pick, tool)).toBe(false);
  });
});
