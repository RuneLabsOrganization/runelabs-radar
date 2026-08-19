/**
 * Narrated demo of the Radar MCP server — the exact calls an agent makes,
 * printed as they happen. Usage: npx tsx mcp/test/demo.ts [baseUrl]
 * NOTE: the generate_plan step spends ~7 real MiniMax calls (first run only;
 * afterwards it's served from the cache).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3122';

async function main() {
  console.log(`── 1. HANDSHAKE ──────────────────────────────────────────────`);
  const client = new Client({ name: 'demo-agent', version: '0.1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
  console.log(`connected. server says: ${JSON.stringify(client.getServerVersion())}`);

  const { tools } = await client.listTools();
  console.log(`\n── 2. DISCOVERY — tools/list → ${tools.length} tools ──────────`);
  console.log(tools.map((t) => t.name).join(', '));

  const sc = (r: unknown) =>
    (r as { structuredContent?: Record<string, unknown> }).structuredContent as Record<string, unknown>;

  console.log(`\n── 3. "WHAT'S HAPPENING" — get_top_signals ──────────────────`);
  const signals = sc(await client.callTool({ name: 'get_top_signals', arguments: { limit: 2 } }));
  for (const s of signals.signals as { title: string; score: number }[]) {
    console.log(`  [${s.score}] ${s.title}`);
  }

  console.log(`\n── 4. "WHAT SHOULD I BUILD" — get_opportunities ─────────────`);
  const opps = sc(await client.callTool({ name: 'get_opportunities', arguments: { limit: 1 } }));
  const opp = (opps.opportunities as Record<string, unknown>[])[0]!;
  console.log(`  ${opp.title}  (flip ${opp.flip_score}/100, hold ${opp.hold_score}/100, verdict: ${opp.verdict})`);
  console.log(`  slug: ${opp.slug} · has_plan: ${opp.has_plan}`);

  console.log(`\n── 5. THE DOSSIER — get_opportunity("${opp.slug}") ──────────`);
  const dossier = sc(await client.callTool({ name: 'get_opportunity', arguments: { opportunity: opp.slug } }));
  const o = dossier.opportunity as Record<string, unknown>;
  console.log(`  thesis: ${String(o.thesis).slice(0, 140)}…`);
  console.log(`  sub-scores: ${JSON.stringify(o.sub_scores).slice(0, 120)}…`);
  const review = o.review as { killRisks?: string[] } | null;
  if (review?.killRisks?.length) console.log(`  critic kill-risk: ${review.killRisks[0]}`);

  console.log(`\n── 6. THE GUIDED WORKFLOW — prompts/get find_and_plan ───────`);
  const prompt = await client.getPrompt({ name: 'find_and_plan', arguments: {} });
  const promptText = (prompt.messages[0]!.content as { text: string }).text;
  console.log(
    promptText
      .split('\n')
      .slice(0, 8)
      .map((l) => `  ${l}`)
      .join('\n'),
  );

  console.log(`\n── 7. THE FLAGSHIP — generate_plan("${opp.slug}") ───────────`);
  console.log('  (6 LLM calls on first run; instant from cache after)');
  const t0 = Date.now();
  // generation takes 30-100s — well past the 60s default timeout; progress
  // notifications reset it (resetTimeoutOnProgress) and narrate the phases
  const gen = sc(
    await client.callTool(
      { name: 'generate_plan', arguments: { opportunity: opp.slug as string } },
      undefined,
      {
        timeout: 300_000,
        resetTimeoutOnProgress: true,
        onprogress: (p) => console.log(`  … progress ${p.progress}/${p.total ?? '?'} — ${p.message ?? ''}`),
      },
    ),
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (gen.ok !== true) {
    console.log(`  generation failed: ${gen.error}`);
    process.exit(1);
  }
  const plan = gen.plan as {
    title: string;
    overview: string;
    total_estimate_hours: number;
    phases: { phase: string; goal: string; tasks: { id: string; title: string; acceptance: string[] }[] }[];
  };
  console.log(`  ok=true cached=${gen.cached} in ${elapsed}s — "${plan.title}" (~${plan.total_estimate_hours}h total)`);
  console.log(`  overview: ${plan.overview.slice(0, 160)}…`);
  for (const p of plan.phases) {
    console.log(`  ${p.phase.padEnd(10)} ${p.tasks.length} tasks — ${p.goal.slice(0, 70)}`);
  }
  const first = plan.phases[0]!.tasks[0]!;
  console.log(`\n  first task: [${first.id}] ${first.title}`);
  console.log(`  acceptance: ${first.acceptance[0]}`);

  console.log(`\n── 8. THE ARTIFACT — get_plan(format=markdown) + radar://plan ─`);
  const md = sc(
    await client.callTool({ name: 'get_plan', arguments: { opportunity: opp.slug as string, format: 'markdown' } }),
  );
  console.log(
    (md.markdown as string)
      .split('\n')
      .slice(0, 18)
      .map((l) => `  ${l}`)
      .join('\n'),
  );
  const res = await client.readResource({ uri: `radar://plan/${opp.slug as string}` });
  const parsed = JSON.parse((res.contents[0] as { text: string }).text) as { found: boolean };
  console.log(`\n  radar://plan/${opp.slug} → found=${parsed.found} (served from cache, zero LLM calls)`);

  console.log(`\nDEMO OK`);
  process.exit(0);
}

main().catch((e) => {
  console.error('DEMO FAILED:', e.message ?? e);
  process.exit(1);
});
