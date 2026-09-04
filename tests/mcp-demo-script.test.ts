/**
 * The landing-page demo's economy receipts must be consistent with DIY_TOKENS
 * by construction — the plan step once showed saved_vs_diy 25700 where
 * DIY − returned = 28000 − 2280 = 25720, and nothing kept the two in sync
 * (G6b). Receipts are now generated from DIY_TOKENS + the displayed returned
 * value via the same substance-scaled rule as the live meter; these tests
 * pin that contract.
 */
import { describe, expect, it } from 'vitest';
import { DEMO_TABS, demoEconomyReceipt } from '@/components/mcp-demo/script';
import { DIY_TOKENS, diySavings, type DiyKind } from '@/lib/mcp-diy';

const RECEIPT_RE = /"economy": \{ "returned": (\d+)(?:, "saved_vs_full": (\d+))?, "saved_vs_diy": (\d+) \}/;

function renderedReceipts(): { tab: string; returned: number; savedVsDiy: number }[] {
  const out: { tab: string; returned: number; savedVsDiy: number }[] = [];
  for (const tab of DEMO_TABS) {
    for (const step of tab.steps) {
      if (step.kind !== 'result') continue;
      for (const line of step.lines) {
        const m = line.match(RECEIPT_RE);
        if (m) out.push({ tab: tab.id, returned: Number(m[1]), savedVsDiy: Number(m[3]) });
      }
    }
  }
  return out;
}

describe('mcp-demo scripted receipts', () => {
  it('every scripted step renders a receipt generated from DIY_TOKENS', () => {
    const receipts = renderedReceipts();
    expect(receipts.map((r) => r.tab).sort()).toEqual(['ask', 'board', 'plan', 'signals']);
    // tab id → the diyKind the receipt was generated with
    const kinds: Record<string, DiyKind> = { ask: 'ask', board: 'decide', plan: 'plan', signals: 'read' };
    for (const r of receipts) {
      // consistent by construction: the displayed number IS diySavings(returned, diy)
      expect(r.savedVsDiy, `${r.tab} receipt`).toBe(diySavings(r.returned, DIY_TOKENS[kinds[r.tab]!]));
    }
  });

  it('above the substance floor, saved === DIY − returned exactly', () => {
    // signals: returned 229 ≥ 10% of read (200) — the unscaled formula
    const signals = renderedReceipts().find((r) => r.tab === 'signals')!;
    expect(signals.savedVsDiy).toBe(DIY_TOKENS.read - signals.returned);
  });

  it('the generator never emits a hand-adjustable number', () => {
    expect(demoEconomyReceipt('plan', 2280, 3540)).toBe(
      `"economy": { "returned": 2280, "saved_vs_full": 3540, "saved_vs_diy": ${diySavings(2280, DIY_TOKENS.plan)} }`,
    );
    // a hypothetical empty reply would claim ~0 savings, not the whole budget
    expect(demoEconomyReceipt('plan', 0)).toBe('"economy": { "returned": 0, "saved_vs_diy": 0 }');
  });
});
