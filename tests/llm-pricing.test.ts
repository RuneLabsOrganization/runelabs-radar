import { afterEach, describe, expect, it, vi } from 'vitest';
import { UNMETERED_COST_USD, estimateCostUsd, isMeteredModel } from '@/lib/llm/pricing';

describe('llm/pricing estimateCostUsd', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prices known models from the static map (unchanged behavior)', () => {
    // MiniMax-M2/M3: $0.30 in / $1.20 out per 1M
    expect(estimateCostUsd('MiniMax-M2', 1_000_000, 1_000_000)).toBeCloseTo(1.5, 12);
    expect(estimateCostUsd('MiniMax-M3', 500_000, 250_000)).toBeCloseTo(0.15 + 0.3, 12);
    expect(isMeteredModel('MiniMax-M2')).toBe(true);
  });

  it('returns the unmetered sentinel for unknown models — never a silent $0', () => {
    // JUSTIFICATION (G1): unknown models used to estimate as 0, so llm_calls
    // rows under-reported money with no signal. The sentinel is negative
    // (impossible as a real cost) so aggregates can count, not sum, the calls.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cost = estimateCostUsd('Unpriced-LLM-9', 1_000_000, 1_000_000);
    expect(cost).toBe(UNMETERED_COST_USD);
    expect(cost).not.toBe(0);
    expect(cost).toBeLessThan(0);
    expect(isMeteredModel('Unpriced-LLM-9')).toBe(false);
  });

  it('warns once per unknown model, not on every call', () => {
    // distinct model name from the other tests — the warn-once set is per process
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    estimateCostUsd('Another-Unpriced-7', 100, 100);
    estimateCostUsd('Another-Unpriced-7', 100, 100);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('Another-Unpriced-7');
  });
});
