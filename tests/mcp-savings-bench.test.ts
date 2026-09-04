/**
 * Savings bench — measures compact-vs-full and DIY token savings on a
 * realistic seeded catalog so marketing copy can quote conservative averages.
 *
 * Run: npx vitest run tests/mcp-savings-bench.test.ts
 * Prints a table to stdout; asserts floors so the numbers cannot silently collapse.
 */
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../mcp/build';
import type { AuthContext } from '../mcp/lib/auth';
import {
  boardEntries,
  metricPoints,
  opportunities,
  painPoints,
  reports,
  stories,
} from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import { estimateTokens, DIY_TOKENS } from '@/lib/mcp-economy';
import { PUBLISHED_SAVINGS } from '@/lib/mcp-savings-copy';
import { renderPlanMarkdown } from '@/lib/plans/markdown';
import type { ExecutionPlan } from '@/lib/plans/schema';

const AUTH: AuthContext = {
  authed: false,
  userId: null,
  scopes: new Set(['read', 'plans']),
  rateKey: 'savings-bench',
};

interface Economy {
  returned: number;
  saved_vs_full: number;
  saved_vs_diy: number;
}

interface Row {
  tool: string;
  args: string;
  returned: number;
  saved_vs_full: number;
  saved_vs_diy: number;
  content_chars: number;
}

async function wire(): Promise<Client> {
  const server = buildServer(AUTH);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'savings-bench', version: '0.0.1' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as {
    structuredContent?: Record<string, unknown> & { economy?: Economy };
    content?: { type: string; text: string }[];
  };
}

function fatBrief() {
  return {
    icp: 'E-commerce operators with 500+ SKUs paying per-image editors today who need batch background removal without hiring a retouching studio.',
    mvp: [
      'upload API with signed URLs',
      'background removal worker queue',
      'credit billing with Stripe metered',
      'Shopify app listing',
      'failed-image retry + dead letter',
    ],
    stackVenture: 'ai-product',
    stackNotes: 'Next.js + worker + MiniMax image. Avoid training a custom model in v1.',
    unitEconomics: {
      assumptions: ['$0.003/image model cost', 'sell at $0.02', '10k images/mo break-even'],
      monthlyCostUsd: 40,
      suggestedPriceUsd: 29,
      breakEvenCustomers: 2,
    },
    gtm: ['Shopify app store', 'Reddit r/shopify', 'YouTube before/after clips'],
    risks: ['incumbent bulk endpoints', 'unit economics below 10k images/month', 'platform fee squeeze'],
  };
}

function fatReview() {
  return {
    killRisks: [
      'Incumbent image APIs ship bulk endpoints within one release cycle',
      'Unit economics break below 10k images/month',
      'Shopify app-store ranking is winner-take-most',
    ],
    adjustments: [],
    flags: [],
    capsApplied: [],
    criticVerdict: 'watch',
    rawFlip: 74,
    rawHold: 58,
  };
}

function fatEvidence() {
  return [
    { type: 'pain', label: 'reliable bulk background removal for product photos — observed 14x in 14d' },
    { type: 'launch', label: 'Clipdrop bulk API still prices per-seat, not per-image' },
    { type: 'story', label: 'New open image models drop inference 40% week-over-week' },
    { type: 'comp', label: 'Photoroom series B at $500M — proves category, not your wedge' },
    { type: 'entity', label: 'MiniMax Hailuo image — cheapest viable for batch jobs' },
  ];
}

function fatPlan(): ExecutionPlan {
  const mk = (phase: string, n: number) => ({
    id: `${phase}-${n}`,
    title: `${phase} task ${n}: concrete work item with files and acceptance`,
    detail:
      `Do the ${phase} work for item ${n}. Touch the listed files, run the verify command, ` +
      'and only then mark the acceptance criteria. Rollback is a git revert of the listed paths.',
    dependsOn: n > 1 ? [`${phase}-${n - 1}`] : [],
    filesToTouch: [`src/${phase}/${n}.ts`, `tests/${phase}/${n}.test.ts`],
    tools: ['next', 'vitest'],
    acceptance: [`${phase} task ${n} observable criterion A`, `${phase} task ${n} observable criterion B`],
    verify: 'npm test',
    estimateHours: 2,
    rollback: 'git revert the listed files',
  });
  const phases = (['validation', 'build', 'launch', 'gtm', 'revenue'] as const).map((phase) => ({
    phase,
    goal: `${phase} goal: ship this slice with measurable acceptance and a rollback.`,
    tasks: [mk(phase, 1), mk(phase, 2), mk(phase, 3)],
  }));
  return {
    version: 1,
    opportunity: 'bulk-bg-removal-api',
    title: 'Bulk background-removal API',
    overview:
      'A focused API selling bulk background removal to e-commerce sellers, riding newly-cheap image models.',
    icp: 'E-commerce operators with 500+ SKUs paying per-image editors today',
    pricing: { model: 'usage credits', priceUsd: 29, notes: '10x undercut of manual editing' },
    stackVenture: 'ai-product',
    totalEstimateHours: 48,
    phases,
    grounding: ['opportunity dossier', 'launch brief', 'stack playbook: ai-product', 'best-right-now board'],
    generatedAt: '2026-08-25T12:00:00.000Z',
  };
}

function weeklyMarkdown(): string {
  const para =
    'The builder market this week concentrated around cheaper image inference, coding-agent stack churn, ' +
    'and a handful of pursue-grade openings in e-commerce tooling. Board picks shifted on copy and video. ';
  return [
    '# State of the Builder Market — week of 2026-08-24',
    '',
    '## Signals',
    para.repeat(8),
    '## Board moves',
    para.repeat(6),
    '## Opportunities',
    para.repeat(7),
    '## Launches',
    para.repeat(5),
    '## Anomalies',
    para.repeat(4),
  ].join('\n');
}

function seed(db: ReturnType<typeof useTestDb>): void {
  const now = new Date();
  const plan = fatPlan();
  db.insert(opportunities)
    .values({
      slug: 'bulk-bg-removal-api',
      title: 'Bulk background-removal API',
      thesis:
        'Sellers need cheap bulk background removal; new image models make it 10x cheaper to offer as a usage-priced API instead of a seat license.',
      sector: 'ai-media',
      status: 'active',
      flipScore: 72,
      holdScore: 55,
      scores: JSON.stringify({
        demand: 16,
        buildability: 15,
        margin: 14,
        competition: 9,
        timing: 15,
        moat: 8,
        regClear: 18,
        platformSafe: 12,
        distribution: 11,
        qualityBar: 13,
      }),
      kpis: JSON.stringify({
        initialCostUsd: 400,
        monthlyCostUsd: 40,
        priceUsd: 29,
        timeToMvpDays: 14,
        breakEvenCustomers: 2,
        competitorCount: 6,
        competitionNote: 'Incumbents price per-seat',
        regulatoryNote: null,
      }),
      evidence: JSON.stringify(fatEvidence()),
      window: '6-9 months',
      windowMonths: 8,
      verdict: 'pursue',
      confidence: 60,
      review: JSON.stringify(fatReview()),
      reviewedAt: now,
      brief: JSON.stringify(fatBrief()),
      briefGeneratedAt: now,
      plan: JSON.stringify(plan),
      planGeneratedAt: now,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .run();

  for (const [i, slug] of ['shopify-seo-agent', 'support-ticket-triage', 'ugc-ad-factory', 'local-llm-gateway'].entries()) {
    db.insert(opportunities)
      .values({
        slug,
        title: slug.replace(/-/g, ' '),
        thesis: `${slug} is a wedge for builders who already have distribution and need a cheaper inference stack than the incumbents.`,
        sector: i % 2 === 0 ? 'ai-coding' : 'ai-media',
        status: 'active',
        flipScore: 60 - i * 4,
        holdScore: 50,
        scores: JSON.stringify({ demand: 12, buildability: 14 }),
        kpis: JSON.stringify({ monthlyCostUsd: 20 + i * 5, priceUsd: 19, timeToMvpDays: 21 }),
        evidence: JSON.stringify(fatEvidence().slice(0, 3)),
        verdict: i === 3 ? 'watch' : 'pursue',
        confidence: 50,
        review: JSON.stringify(fatReview()),
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .run();
  }

  db.insert(reports)
    .values({ date: '2026-08-24', markdown: weeklyMarkdown(), createdAt: now })
    .run();

  for (let d = 0; d < 90; d++) {
    const day = new Date(Date.UTC(2026, 5, 1 + d)).toISOString().slice(0, 10);
    db.insert(metricPoints)
      .values({
        source: 'provider-pricing',
        entity: 'minimax-m2',
        metric: 'price_out',
        value: 1.2 - d * 0.002,
        date: day,
        createdAt: now,
      })
      .run();
  }

  db.insert(stories)
    .values({
      title: 'Sonnet 4.6 lands 1M-token context for whole-repo refactors',
      tldr: 'Long context removes the retrieval step from coding-agent loops.',
      status: 'curated',
      topScore: 88,
      createdAt: now,
    })
    .run();
  db.insert(stories)
    .values({
      title: 'Gemini Flash drops 40% — cheap-tier math changes overnight',
      tldr: 'Batch jobs and background agents get a new default.',
      status: 'curated',
      topScore: 81,
      createdAt: now,
    })
    .run();

  db.insert(painPoints)
    .values({
      summary: 'reliable bulk background removal for product photos',
      sector: 'ai-media',
      intensity: 14,
      lastSeenAt: now,
      createdAt: now,
    })
    .run();
  db.insert(painPoints)
    .values({
      summary: 'a coding agent that does not burn the context window on research',
      sector: 'ai-coding',
      intensity: 11,
      lastSeenAt: now,
      createdAt: now,
    })
    .run();

  db.insert(boardEntries)
    .values({
      domain: 'coding',
      task: 'summarize support tickets',
      bestOverall: 'Claude Sonnet',
      bestValue: 'MiniMax M2',
      cheapestViable: 'Gemini Flash',
      costNote: 'Flash wins on batch; Sonnet wins on messy tickets.',
      runelabsVerdict: 'Start with Flash, escalate exceptions to Sonnet.',
      updatedAt: now,
    })
    .run();
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

describe('mcp savings bench', () => {
  it('prints compact-vs-full and DIY savings on a fat catalog', async () => {
    const db = useTestDb();
    seed(db);
    const client = await wire();
    const rows: Row[] = [];

    const capture = async (tool: string, args: Record<string, unknown>, label?: string) => {
      const res = await call(client, tool, args);
      const eco = res.structuredContent?.economy;
      expect(eco).toBeDefined();
      rows.push({
        tool: label ?? tool,
        args: JSON.stringify(args),
        returned: eco!.returned,
        saved_vs_full: eco!.saved_vs_full,
        saved_vs_diy: eco!.saved_vs_diy,
        content_chars: res.content?.[0]?.text.length ?? 0,
      });
      return res;
    };

    await capture('get_opportunities', { limit: 5 });
    await capture('get_opportunity', { opportunity: 'bulk-bg-removal-api', detail: 'compact' }, 'get_opportunity compact');
    await capture('get_opportunity', { opportunity: 'bulk-bg-removal-api', detail: 'full' }, 'get_opportunity full');
    await capture('get_weekly_report', { detail: 'compact' }, 'get_weekly_report compact');
    await capture('get_weekly_report', { detail: 'full' }, 'get_weekly_report full');
    await capture(
      'get_metric_series',
      { source: 'provider-pricing', entity: 'minimax-m2', metric: 'price_out', days: 90 },
      'get_metric_series stats',
    );
    await capture(
      'get_metric_series',
      { source: 'provider-pricing', entity: 'minimax-m2', metric: 'price_out', days: 90, include_points: true },
      'get_metric_series points',
    );
    await capture('get_plan', { opportunity: 'bulk-bg-removal-api', format: 'markdown' }, 'get_plan markdown');
    await capture('get_plan', { opportunity: 'bulk-bg-removal-api', format: 'json' }, 'get_plan json');
    await capture('whats_relevant', { project: 'a bulk background-removal API for Shopify sellers' });
    await capture('decide', { task: 'summarize support tickets', domain: 'coding' });
    await capture('get_best_right_now', { domain: 'coding' });
    await capture('get_pain_points', { limit: 10 });
    await capture('get_top_signals', { limit: 10 });

    // Dual-dump counterfactual for generate_plan (what we used to ship: JSON + markdown)
    const plan = fatPlan();
    const dual = estimateTokens(JSON.stringify({ plan, markdown: renderPlanMarkdown(plan) }, null, 2));
    const mdOnly = await capture('generate_plan', { opportunity: 'bulk-bg-removal-api', format: 'markdown' }, 'generate_plan markdown');
    expect(mdOnly.structuredContent?.markdown).toBeDefined();
    expect(mdOnly.structuredContent?.plan).toBeUndefined();

    const compactReads = rows.filter((r) =>
      ['get_opportunity compact', 'get_weekly_report compact', 'get_metric_series stats', 'get_opportunities', 'whats_relevant', 'decide'].includes(
        r.tool,
      ),
    );
    const avgReturned = Math.round(compactReads.reduce((s, r) => s + r.returned, 0) / compactReads.length);
    const avgSavedFull = Math.round(compactReads.reduce((s, r) => s + r.saved_vs_full, 0) / compactReads.length);
    const avgSavedDiy = Math.round(compactReads.reduce((s, r) => s + r.saved_vs_diy, 0) / compactReads.length);
    const dossier = rows.find((r) => r.tool === 'get_opportunity compact')!;
    const dossierFull = rows.find((r) => r.tool === 'get_opportunity full')!;
    const weekly = rows.find((r) => r.tool === 'get_weekly_report compact')!;
    const weeklyFull = rows.find((r) => r.tool === 'get_weekly_report full')!;
    const metrics = rows.find((r) => r.tool === 'get_metric_series stats')!;
    const planMd = rows.find((r) => r.tool === 'generate_plan markdown')!;

    // eslint-disable-next-line no-console
    console.log('\n=== MCP token-savings bench (chars÷4) ===');
    for (const r of rows) {
      // eslint-disable-next-line no-console
      console.log(
        `${r.tool.padEnd(32)} returned=${String(r.returned).padStart(5)}  vs_full=+${String(r.saved_vs_full).padStart(5)}  vs_diy=+${String(r.saved_vs_diy).padStart(5)}  content_chars=${r.content_chars}`,
      );
    }
    // eslint-disable-next-line no-console
    console.log('--- averages (compact job/read set) ---');
    // eslint-disable-next-line no-console
    console.log(`avg returned=${fmt(avgReturned)}  avg saved_vs_full=${fmt(avgSavedFull)}  avg saved_vs_diy=${fmt(avgSavedDiy)}`);
    // eslint-disable-next-line no-console
    console.log(
      `dossier compact vs full: ${fmt(dossier.returned)} vs ${fmt(dossierFull.returned)} (full dump would have been ~${fmt(dossier.returned + dossier.saved_vs_full)})`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `weekly compact vs full: ${fmt(weekly.returned)} vs ${fmt(weeklyFull.returned)}`,
    );
    // eslint-disable-next-line no-console
    console.log(`generate_plan markdown returned=${fmt(planMd.returned)}  old dual dump ≈ ${fmt(dual)}  saved_vs_full=${fmt(planMd.saved_vs_full)}`);
    // eslint-disable-next-line no-console
    console.log('=========================================\n');

    // Floors — compact must beat full, DIY savings must stay material
    expect(dossier.returned).toBeLessThan(dossierFull.returned);
    expect(weekly.returned).toBeLessThan(weeklyFull.returned);
    expect(metrics.saved_vs_full).toBeGreaterThan(0);
    expect(avgSavedDiy).toBeGreaterThan(1_000);
    expect(planMd.saved_vs_diy).toBeGreaterThan(10_000);

    // Marketing copy must stay at or below the bench (under-claim).
    expect(avgReturned).toBeGreaterThanOrEqual(PUBLISHED_SAVINGS.compactAvgReturned);
    expect(avgSavedDiy).toBeGreaterThanOrEqual(PUBLISHED_SAVINGS.compactAvgSavedVsDiy);
    expect(avgSavedFull).toBeGreaterThanOrEqual(PUBLISHED_SAVINGS.compactAvgSavedVsFull);
    expect(weeklyFull.returned / weekly.returned).toBeGreaterThanOrEqual(PUBLISHED_SAVINGS.weeklyFullVsCompact);
    expect(planMd.saved_vs_diy).toBeGreaterThanOrEqual(PUBLISHED_SAVINGS.planDiySaved);
    // JUSTIFICATION (G6c): the session figure was a hand-sum (22k+8k+25k) with
    // no bench floor while every other constant had one. Session = ask_radar
    // (constant, not LLM-benched) + compact dossier + generate_plan.
    expect(DIY_TOKENS.ask + dossier.saved_vs_diy + planMd.saved_vs_diy).toBeGreaterThanOrEqual(
      PUBLISHED_SAVINGS.sessionDiySaved,
    );
  });
});
