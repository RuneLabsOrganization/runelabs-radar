/**
 * Exhaustive live test of the running MCP server — every tool, resource,
 * template and prompt, over the real HTTP transport.
 * Usage: npx tsx mcp/test/live.ts [baseUrl]   (default http://127.0.0.1:3122)
 * Optional: SMOKE_TOKEN=<bearer> when the server requires auth.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadDotEnv } from '../../src/lib/env';

loadDotEnv();

const BASE = process.argv[2] ?? 'http://127.0.0.1:3122';
const TOKEN = process.env.SMOKE_TOKEN;

/** Self-seed a throwaway metric series so get_metric_series has live data; removed on exit. */
async function seedMetricFixture(): Promise<void> {
  if (!BASE.includes('127.0.0.1') && !BASE.includes('localhost')) return; // only against a local DB
  const { upsertMetric, utcDay } = await import('../../src/lib/metrics');
  for (let i = 9; i >= 0; i--) {
    upsertMetric({
      source: 'livetest',
      entity: 'widget',
      metric: 'price',
      value: 10 - i * 0.5,
      date: utcDay(new Date(Date.now() - i * 864e5)),
    });
  }
}
async function cleanMetricFixture(): Promise<void> {
  if (!BASE.includes('127.0.0.1') && !BASE.includes('localhost')) return;
  const { getDb } = await import('../../src/lib/db');
  getDb().run("DELETE FROM metric_points WHERE source = 'livetest'");
}

let passed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(label);
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  await seedMetricFixture();
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: TOKEN ? { headers: { authorization: `Bearer ${TOKEN}` } } : undefined,
  });
  const client = new Client({ name: 'radar-live-test', version: '0.2.0' });
  await client.connect(transport);
  console.log(`connected to ${BASE}/mcp\n== tools ==`);

  const envelopeMisses: string[] = [];
  const sc = (r: unknown) => {
    const s = (r as { structuredContent?: Record<string, unknown> }).structuredContent ?? {};
    // every structured payload must carry the envelope
    if (typeof s.summary !== 'string' || !Array.isArray(s.next)) {
      envelopeMisses.push(Object.keys(s).slice(0, 3).join(',') || '(empty)');
    }
    return s;
  };
  const txt = (r: unknown) =>
    ((r as { content?: { type: string; text: string }[] }).content ?? []).map((c) => c.text).join('\n');

  // meta
  const guide = await client.callTool({ name: 'get_server_guide', arguments: {} });
  check('get_server_guide', txt(guide).includes('flagship workflow'));

  // briefs
  const brief = await client.callTool({ name: 'get_daily_brief', arguments: {} });
  check('get_daily_brief (latest)', txt(brief).length > 40);
  const digest = sc(await client.callTool({ name: 'get_domain_digest', arguments: { domain: 'coding' } }));
  check('get_domain_digest', Array.isArray(digest.digests), `date=${digest.date}`);
  const insights = sc(await client.callTool({ name: 'get_daily_insights', arguments: {} }));
  check('get_daily_insights', Array.isArray(insights.items), `date=${insights.date}`);

  // signals
  const signals = sc(await client.callTool({ name: 'get_top_signals', arguments: { limit: 3 } }));
  check('get_top_signals', Array.isArray(signals.signals), `count=${signals.count}`);
  const firstStory = (signals.signals as { id: number; title: string }[])[0];
  if (firstStory) {
    const story = sc(await client.callTool({ name: 'get_story', arguments: { id: firstStory.id } }));
    check('get_story', story.found === true && typeof story.story === 'object');
  } else {
    check('get_story', false, 'no signals to fetch');
  }
  // search a word taken from a live signal title — a guaranteed FTS hit
  const term = firstStory?.title.split(/\s+/).find((w) => w.replace(/[^a-z]/gi, '').length > 4) ?? 'model';
  const search = sc(await client.callTool({ name: 'search_stories', arguments: { query: term, limit: 3 } }));
  check('search_stories', Array.isArray(search.results) && (search.count as number) > 0, `term="${term}" count=${search.count}`);

  // launches
  const launches = sc(await client.callTool({ name: 'get_launches', arguments: { days: 30, limit: 5 } }));
  check('get_launches', Array.isArray(launches.launches), `count=${launches.count}`);

  // board
  const board = sc(await client.callTool({ name: 'get_best_right_now', arguments: { domain: 'agentic' } }));
  check('get_best_right_now', Array.isArray(board.board), `count=${board.count}`);
  const changes = sc(await client.callTool({ name: 'get_board_changes', arguments: { days: 90 } }));
  check('get_board_changes', Array.isArray(changes.changes), `count=${changes.count}`);

  // stacks
  const stackList = sc(await client.callTool({ name: 'list_stacks', arguments: {} }));
  check('list_stacks', Array.isArray(stackList.stacks) && (stackList.count as number) > 0, `count=${stackList.count}`);
  const venture = (stackList.stacks as { venture: string }[])[0]?.venture;
  const stack = sc(await client.callTool({ name: 'get_stack_for', arguments: { venture: venture ?? 'saas-b2b' } }));
  check('get_stack_for', stack.found === true && Array.isArray(stack.layers), `venture=${venture}`);
  const noStack = sc(await client.callTool({ name: 'get_stack_for', arguments: { venture: '__nope__' } }));
  check('get_stack_for (miss)', noStack.found === false && Array.isArray(noStack.available));

  // opportunities
  const opps = sc(await client.callTool({ name: 'get_opportunities', arguments: { limit: 3 } }));
  check('get_opportunities', Array.isArray(opps.opportunities), `count=${opps.count}`);
  const slug = (opps.opportunities as { slug: string }[])[0]?.slug;
  if (slug) {
    const dossier = sc(await client.callTool({ name: 'get_opportunity', arguments: { opportunity: slug } }));
    check('get_opportunity', dossier.found === true, `slug=${slug}`);
  } else {
    check('get_opportunity', false, 'no opportunities to fetch');
  }
  const noOpp = sc(await client.callTool({ name: 'get_opportunity', arguments: { opportunity: '__nope__' } }));
  check('get_opportunity (miss)', noOpp.found === false);

  // pains / patterns / map
  const pains = sc(await client.callTool({ name: 'get_pain_points', arguments: { limit: 5 } }));
  check('get_pain_points', Array.isArray(pains.pains), `count=${pains.count}`);
  const patterns = sc(await client.callTool({ name: 'get_patterns', arguments: { days: 30 } }));
  check('get_patterns', Array.isArray(patterns.patterns), `count=${patterns.count}`);
  const map = sc(await client.callTool({ name: 'get_topic_map', arguments: {} }));
  check('get_topic_map', Array.isArray(map.topics), `as_of=${map.as_of}`);

  // market / metrics
  const market = sc(await client.callTool({ name: 'get_market_models', arguments: { limit: 3 } }));
  check(
    'get_market_models',
    market.restricted === true || Array.isArray(market.models),
    market.restricted ? 'restricted (anonymous + AA_PUBLIC=false, correct)' : `count=${market.count}`,
  );
  const metrics = sc(await client.callTool({ name: 'list_metrics', arguments: { limit: 5 } }));
  check('list_metrics', Array.isArray(metrics.metrics), `count=${metrics.count}`);
  const m0 = (metrics.metrics as { source: string; entity: string; metric: string }[])[0];
  if (m0) {
    const series = sc(
      await client.callTool({
        name: 'get_metric_series',
        arguments: { source: m0.source, entity: m0.entity, metric: m0.metric, days: 30 },
      }),
    );
    check('get_metric_series', series.found === true && Array.isArray(series.points), `${m0.entity}/${m0.metric}`);
  } else {
    check('get_metric_series', false, 'no metrics to fetch');
  }

  // forecasts / accuracy
  const forecasts = sc(await client.callTool({ name: 'get_forecasts', arguments: {} }));
  check('get_forecasts', Array.isArray(forecasts.grades), `count=${(forecasts.grades as unknown[]).length}`);
  const accuracy = sc(await client.callTool({ name: 'get_accuracy', arguments: {} }));
  check('get_accuracy', Array.isArray(accuracy.calibration), `spearman=${accuracy.spearman}`);

  // entities / comps
  const entity = sc(await client.callTool({ name: 'get_entity', arguments: { name: 'OpenAI' } }));
  check('get_entity', entity.found === true || Array.isArray(entity.suggestions), `found=${entity.found}`);
  const noEntity = sc(await client.callTool({ name: 'get_entity', arguments: { name: 'zzz-no-such-entity-zzz' } }));
  check('get_entity (miss)', noEntity.found === false && Array.isArray(noEntity.suggestions));
  const comps = sc(await client.callTool({ name: 'get_comps', arguments: { limit: 3 } }));
  check('get_comps', Array.isArray(comps.comps), `count=${comps.count}`);

  // plans (miss path only — generation is LLM spend, covered by unit tests)
  const noPlan = sc(await client.callTool({ name: 'get_plan', arguments: { opportunity: '__nope__' } }));
  check('get_plan (miss)', noPlan.found === false);

  check(
    'envelope (summary + next) on every structured response',
    envelopeMisses.length === 0,
    envelopeMisses.join(' | '),
  );

  console.log('\n== resources ==');
  const { resources } = await client.listResources();
  check('resources/list', resources.length >= 3, resources.map((r) => r.uri).join(', '));
  const { resourceTemplates } = await client.listResourceTemplates();
  check('resource templates', resourceTemplates.length >= 4, resourceTemplates.map((t) => t.uriTemplate).join(', '));

  const readJson = async (uri: string) => {
    const r = await client.readResource({ uri });
    return JSON.parse((r.contents[0] as { text: string }).text) as Record<string, unknown>;
  };
  const briefRes = await client.readResource({ uri: 'radar://brief/latest' });
  check('radar://brief/latest', ((briefRes.contents[0] as { text: string }).text ?? '').length > 40);
  check('radar://opportunities', Array.isArray((await readJson('radar://opportunities')).opportunities));
  if (slug) check('radar://opportunity/{slug}', (await readJson(`radar://opportunity/${slug}`)).found === true);
  check('radar://board/coding', Array.isArray((await readJson('radar://board/coding')).board));
  if (venture) check('radar://stacks/{venture}', (await readJson(`radar://stacks/${venture}`)).found === true);
  check('radar://map/latest', Array.isArray((await readJson('radar://map/latest')).topics));
  if (slug) {
    const planRes = await readJson(`radar://plan/${slug}`);
    check('radar://plan/{slug}', planRes.found === true || typeof planRes.reason === 'string', `found=${planRes.found}`);
  }

  console.log('\n== prompts ==');
  const { prompts } = await client.listPrompts();
  check('prompts/list', prompts.length === 5, prompts.map((p) => p.name).join(', '));
  const fp = await client.getPrompt({ name: 'find_and_plan', arguments: { sector: 'devtools' } });
  check('find_and_plan', JSON.stringify(fp.messages).includes('generate_plan'));
  const wn = await client.getPrompt({ name: 'whats_new_today', arguments: {} });
  check('whats_new_today', JSON.stringify(wn.messages).includes('get_daily_brief'));
  const wu = await client.getPrompt({ name: 'what_should_i_use', arguments: { task: 'summarize tickets' } });
  check('what_should_i_use', JSON.stringify(wu.messages).includes('summarize tickets'));
  const vi = await client.getPrompt({ name: 'validate_idea', arguments: { idea: 'test idea' } });
  check('validate_idea', JSON.stringify(vi.messages).includes('test idea'));
  const wr = await client.getPrompt({ name: 'builder_weekly_review', arguments: {} });
  check('builder_weekly_review', JSON.stringify(wr.messages).includes('get_board_changes'));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  await cleanMetricFixture();
  if (failures.length > 0) {
    console.log('failures:', failures.join(' | '));
    process.exit(1);
  }
  console.log('LIVE OK');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('LIVE FAILED:', e);
  await cleanMetricFixture().catch(() => {});
  process.exit(1);
});
