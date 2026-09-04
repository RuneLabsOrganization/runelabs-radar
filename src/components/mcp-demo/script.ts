/**
 * Scripted MCP sessions for the landing-page demo.
 *
 * Every tool name, argument and response field here mirrors the real server
 * surface (mcp/tools/*.ts) — including the `summary` + `next` envelope that
 * every structured payload carries. Payloads are trimmed for readability, not
 * invented.
 */
import { DIY_TOKENS, diySavings, type DiyKind } from '@/lib/mcp-diy';
import { PUBLISHED_SAVINGS, fmtTokens } from '@/lib/mcp-savings-copy';

export type DemoStep =
  | { kind: 'user'; text: string }
  | { kind: 'call'; tool: string; args: string[]; runMs: number; running: string }
  | { kind: 'result'; meta: string; lines: string[] }
  | { kind: 'assistant'; text: string }
  | { kind: 'file'; name: string; lines: string[] }
  | { kind: 'chain'; tool: string; reason: string };

export interface DemoTab {
  id: string;
  label: string;
  client: string;
  headline: string;
  blurb: string;
  steps: DemoStep[];
}

/**
 * Economy receipts are computed, never hand-written: saved_vs_diy derives
 * from DIY_TOKENS + the displayed `returned` via the same substance-scaled
 * rule the live meter applies (mcp-diy.ts), so a receipt can never drift from
 * the constants it claims — the plan step once read 25700 where
 * DIY − returned = 25720, and nothing kept the two in sync.
 */
export function demoEconomyReceipt(diyKind: DiyKind, returned: number, savedVsFull?: number): string {
  const parts = [`"returned": ${returned}`];
  if (savedVsFull !== undefined) parts.push(`"saved_vs_full": ${savedVsFull}`);
  parts.push(`"saved_vs_diy": ${diySavings(returned, DIY_TOKENS[diyKind])}`);
  return `"economy": { ${parts.join(', ')} }`;
}

export const DEMO_TABS: DemoTab[] = [
  {
    id: 'ask',
    label: 'Ask Radar',
    client: 'Cursor',
    headline: 'One question. Radar already did the research.',
    blurb:
      'ask_radar synthesizes signals, openings, pains and the board server-side. Your coding agent gets a grounded brief — not four tool dumps to stitch together.',
    steps: [
      {
        kind: 'user',
        text: 'What should I build this week that I can ship as a solo founder?',
      },
      {
        kind: 'call',
        tool: 'ask_radar',
        args: [
          '{',
          '  "question": "What should I build this week that I',
          '               can ship as a solo founder?"',
          '}',
        ],
        runMs: 1400,
        running: 'grounding · opportunities · pains · board',
      },
      {
        kind: 'result',
        meta: 'structuredContent · 1.4s',
        lines: [
          '{',
          '  "summary": "Pursue-grade: bulk-bg-removal-api',
          '              (flip 72) — image inference just got cheap.",',
          '  "ok": true,',
          '  "confidence": 71,',
          '  "answer": "The strongest opening on the board is a',
          '    usage-priced bulk background-removal API…",',
          '  "citations": [',
          '    { "label": "bulk-bg-removal-api", "url": "…" },',
          '    { "label": "pain: product-photo retouching" }',
          '  ],',
          `  ${demoEconomyReceipt('ask', 380)},`,
          '  "next": [ { "tool": "get_opportunity", "arguments":',
          '    { "detail": "compact" } } ]',
          '}',
        ],
      },
      {
        kind: 'assistant',
        text: 'Radar already ranked it. **bulk-bg-removal-api** is pursue-grade (flip 72) — newly-cheap image models, observed pain in product photos, incumbents still on seat licenses. Compact dossier next, then a plan if you want to ship.',
      },
      {
        kind: 'chain',
        tool: 'get_opportunity',
        reason: 'compact dossier — scores, KPIs, kill risks (not the full brief dump)',
      },
    ],
  },
  {
    id: 'debate',
    label: 'Pressure-test',
    client: 'Cursor',
    headline: 'Kill the bad idea before you build it',
    blurb:
      'debate_idea runs a four-role debate — advocate, skeptic, market realist, judge — grounded in observed pains, money comps, launch activity and the live model market. You get a verdict, not vibes.',
    steps: [
      {
        kind: 'user',
        text: 'Pressure-test this before I write any code: a bulk background-removal API for Shopify sellers, priced per image.',
      },
      {
        kind: 'call',
        tool: 'debate_idea',
        args: [
          '{',
          '  "idea": "A bulk background-removal API for Shopify',
          '           sellers, priced per image, with a queue for',
          '           10k+ SKU catalogs."',
          '}',
        ],
        runMs: 1900,
        running: 'grounding · advocate → skeptic → realist → judge',
      },
      {
        kind: 'result',
        meta: 'structuredContent · 1.9s',
        lines: [
          '{',
          '  "summary": "Debate verdict: watch (confidence 62) —',
          '              2 kill risks, 3 strengthened variants.",',
          '  "ok": true,',
          '  "verdict": "watch",',
          '  "confidence": 62,',
          '  "grounding": [',
          '    "6 observed pains in sector \\"e-commerce\\"",',
          '    "6 money comps (exits/revenue) from the last 60d",',
          '    "launch activity from the last 7d (42 launches)",',
          '    "closest tracked opportunities: bulk-bg-removal-api"',
          '  ],',
          '  "kill_risks": [',
          '    "Incumbent image APIs ship bulk endpoints within',
          '     one release cycle",',
          '    "Unit economics break below 10k images/month"',
          '  ],',
          '  "conditions_to_succeed": [',
          '    "A latency wedge (<500ms/image) on batch jobs",',
          '    "Shopify app-store distribution, not cold outbound"',
          '  ],',
          '  "transcript": [ 4 turns ],',
          '  "next": [ { "tool": "generate_plan", … } ]',
          '}',
        ],
      },
      {
        kind: 'assistant',
        text: 'The judge said **watch**, not reject — confidence 62. Two things would kill it: incumbents shipping bulk endpoints, and the unit economics below 10k images/month. It survives if you win on batch latency and distribute through the Shopify app store. This exact opening is already tracked as `bulk-bg-removal-api`, so I can pull a plan for it.',
      },
      {
        kind: 'chain',
        tool: 'generate_plan',
        reason: 'an execution plan for the closest tracked opportunity "bulk-bg-removal-api"',
      },
    ],
  },
  {
    id: 'plan',
    label: 'Ship it',
    client: 'Claude Code',
    headline: 'A plan your agent can actually execute',
    blurb:
      `generate_plan returns one format (markdown by default) — not JSON and markdown together. Your agent writes PLAN.md and starts working. ~${fmtTokens(PUBLISHED_SAVINGS.planDiySaved)} DIY tokens kept out of a local research loop.`,
    steps: [
      {
        kind: 'user',
        text: 'Generate the execution plan for bulk-bg-removal-api and save it as PLAN.md.',
      },
      {
        kind: 'call',
        tool: 'generate_plan',
        args: ['{', '  "opportunity": "bulk-bg-removal-api",', '  "format": "markdown"', '}'],
        runMs: 2100,
        running: 'dossier · stack playbook · board · model prices',
      },
      {
        kind: 'result',
        meta: 'structuredContent · 2.1s',
        lines: [
          '{',
          '  "summary": "New plan \\"Bulk BG Removal API\\" —',
          '              5 phases, 23 tasks, ~48h total.",',
          '  "ok": true,',
          '  "cached": false,',
          '  "format": "markdown",',
          '  "markdown": "# Bulk BG Removal API\\n…",',
          `  ${demoEconomyReceipt('plan', 2280, 3540)},`,
          '  "next": [ { "tool": "get_plan", "arguments":',
          '    { "format": "json" } } ]',
          '}',
        ],
      },
      {
        kind: 'file',
        name: 'PLAN.md',
        lines: [
          '# Bulk BG Removal API',
          '',
          '## Phase 2 — build',
          '',
          '### build-3 · Queue worker for 10k-image batches',
          '- depends_on: build-1, build-2',
          '- files_to_touch: worker/queue.ts, src/lib/jobs.ts',
          '- acceptance:',
          '  - 10k images complete in under 20 minutes',
          '  - failed images retry twice, then dead-letter',
          '- verify: `npm run test -- queue`',
          '- rollback: revert worker/queue.ts, drain the queue',
          '- estimate_hours: 6',
        ],
      },
      {
        kind: 'assistant',
        text: 'Plan written to `PLAN.md` — 5 phases, 23 tasks, about 48 hours. Every task carries its own acceptance criteria and a verify command, so I can work through them one at a time and check myself. Want me to start on the validation phase?',
      },
    ],
  },
  {
    id: 'signals',
    label: 'What changed',
    client: 'Cursor',
    headline: 'The last 48 hours, already synthesized',
    blurb:
      'Prefer ask_radar. If you only need the feed, get_top_signals is compact: a one-line summary in the text block, structured fields for the client — not a pretty-printed dump. Free and unlimited.',
    steps: [
      { kind: 'user', text: 'What changed in AI coding tools in the last 48 hours?' },
      {
        kind: 'call',
        tool: 'get_top_signals',
        args: ['{', '  "domain": "coding",', '  "hours": 48,', '  "limit": 4', '}'],
        runMs: 700,
        running: 'reading curated signals',
      },
      {
        kind: 'result',
        meta: 'structuredContent · 0.7s',
        lines: [
          '{',
          '  "summary": "4 coding signals in the last 48h.",',
          '  "window_hours": 48,',
          '  "domain": "coding",',
          '  "count": 4,',
          '  "signals": [',
          '    {',
          '      "id": 8421,',
          '      "title": "Sonnet 4.6 lands 1M-token context",',
          '      "score": 91,',
          '      "why_it_matters": "Whole-repo refactors stop',
          '        needing a retrieval step.",',
          '      "created_at": "2026-08-22T14:02:11.000Z"',
          '    },',
          '    { "id": 8417, "title": "Cursor ships background', 
          '      agents on the free tier", "score": 84 },',
          '    { "id": 8402, "title": "Gemini Flash price cut 40%",',
          '      "score": 78 }',
          '  ],',
          '  "next": [ { "tool": "get_story", … } ],',
          `  ${demoEconomyReceipt('read', 229)}`,
          '}',
        ],
      },
      {
        kind: 'assistant',
        text: 'Three things matter for you. Sonnet 4.6 now takes a 1M-token context, which removes the retrieval step from whole-repo refactors. Cursor moved background agents to the free tier. And Gemini Flash dropped 40%, which changes the cheap-tier math in your cost model.',
      },
      { kind: 'chain', tool: 'get_story', reason: 'full detail, sources and second-look on the top signal' },
    ],
  },
  {
    id: 'board',
    label: 'What to use',
    client: 'Zed',
    headline: 'A picked answer, one call',
    blurb:
      'decide returns board + market in one shot — best overall, best value, cheapest viable, with the cost note. Replaces the old three-tool fetch quest.',
    steps: [
      { kind: 'user', text: "I'm doing a 40-file refactor tonight. Which model should I actually use?" },
      {
        kind: 'call',
        tool: 'decide',
        args: ['{', '  "task": "40-file refactor",', '  "domain": "coding"', '}'],
        runMs: 550,
        running: 'board + market in one shot',
      },
      {
        kind: 'result',
        meta: 'structuredContent · 0.6s',
        lines: [
          '{',
          '  "summary": "Use Claude Sonnet for this refactor —',
          '              Flash is 8× cheaper for single-file edits.",',
          '  "board": [{',
          '    "task": "long-context refactor",',
          '    "best_overall": "Claude Sonnet 4.6",',
          '    "best_value": "Gemini 2.5 Flash",',
          '    "cheapest_viable": "DeepSeek V3",',
          '    "cost_note": "Sonnet wins on multi-file coherence"',
          '  }],',
          '  "recommendation": "Sonnet for refactors >20 files;",',
          `  ${demoEconomyReceipt('decide', 241)},`,
          '  "next": []',
          '}',
        ],
      },
      {
        kind: 'assistant',
        text: 'Use **Claude Sonnet 4.6**. The board draws the line at 20 files, and you are at 40 — Sonnet holds coherence across the whole change set. Flash is 8× cheaper but only for single-file edits, so save it for the cleanup pass afterwards.',
      },
    ],
  },
  {
    id: 'batch',
    label: 'Batch',
    client: 'Claude Desktop',
    headline: 'Run the whole shortlist at once',
    blurb:
      'Batches turn a list into execution. Collect opportunities, stories or raw ideas in the workspace, then have your agent debate or plan every item in one call and poll the run.',
    steps: [
      { kind: 'user', text: 'Debate everything in my Q3 shortlist and tell me what survived.' },
      {
        kind: 'call',
        tool: 'run_batch',
        args: ['{', '  "slug": "q3-shortlist",', '  "op": "debate"', '}'],
        runMs: 2300,
        running: 'debating 5 items',
      },
      {
        kind: 'result',
        meta: 'structuredContent · 2.3s',
        lines: [
          '{',
          '  "summary": "Batch run completed (5/5 debated).",',
          '  "ok": true,',
          '  "run_id": 42,',
          '  "status": "completed",',
          '  "stats": "5/5 debated",',
          '  "next": [ { "tool": "get_batch_run",',
          '              "arguments": { "run_id": 42 } } ]',
          '}',
        ],
      },
      {
        kind: 'call',
        tool: 'get_batch_run',
        args: ['{', '  "run_id": 42', '}'],
        runMs: 500,
        running: 'collecting per-item verdicts',
      },
      {
        kind: 'result',
        meta: 'structuredContent · 0.5s',
        lines: [
          '{',
          '  "found": true,',
          '  "run": {',
          '    "id": 42,',
          '    "op": "debate",',
          '    "status": "completed",',
          '    "stats": "5/5 debated · 1 pursue, 2 watch, 2 reject"',
          '  }',
          '}',
        ],
      },
      {
        kind: 'assistant',
        text: 'Five debated, one survived. `agent-eval-harness` came back **pursue** at confidence 78 — the only one where the judge found no structural kill risk. Two are worth watching, two are dead. Want the plan for the survivor?',
      },
    ],
  },
];
