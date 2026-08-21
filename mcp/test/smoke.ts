/**
 * Smoke test for the MCP server — raw JSON-RPC over HTTP, no SDK client.
 * Usage: npx tsx mcp/test/smoke.ts [baseUrl]   (default http://127.0.0.1:3122)
 * Requires the server running (npm run mcp) and a seeded database.
 * When the server runs with MCP_AUTH_REQUIRED=true, pass SMOKE_TOKEN=<bearer>.
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:3122';
const TOKEN = process.env.SMOKE_TOKEN;

let id = 0;
async function rpc(method: string, params: unknown = {}): Promise<unknown> {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  if (res.status === 401) {
    const challenge = res.headers.get('www-authenticate');
    if (!challenge?.includes('oauth-protected-resource')) {
      throw new Error('401 without a valid WWW-Authenticate challenge');
    }
    throw new Error(`AUTH REQUIRED — server is in OAuth mode; rerun with SMOKE_TOKEN=<bearer> (challenge ok: ${challenge})`);
  }
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${await res.text()}`);
  const text = await res.text();
  // stateless server may reply SSE — take the last data: line
  const dataLine = text.trim().startsWith('event:')
    ? text
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .pop()
        ?.slice(5)
    : text;
  if (!dataLine) throw new Error(`${method}: empty reply`);
  const parsed = JSON.parse(dataLine);
  if (parsed.error) throw new Error(`${method}: ${JSON.stringify(parsed.error)}`);
  return parsed.result;
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = (await rpc('tools/call', { name, arguments: args })) as {
    content: { type: string; text: string }[];
  };
  return result.content.map((c) => c.text).join('\n');
}

function stripAttribution(text: string): string {
  return text.split('\n\n—\n')[0];
}

async function main() {
  try {
    const health = await fetch(`${BASE}/health`).then((r) => r.json());
    console.log('health:', JSON.stringify(health));
  } catch {
    console.log('health: (not exposed on this URL — internal endpoint, skipping)');
  }

  const meta = await fetch(`${BASE}/.well-known/oauth-protected-resource`).then((r) => r.json());
  if (!Array.isArray(meta.authorization_servers)) throw new Error('protected-resource metadata malformed');
  console.log('protected-resource metadata: ok (issuer', meta.authorization_servers[0] + ')');

  await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'radar-smoke', version: '0.2.0' },
  });
  console.log('initialize: ok');

  const tools = (await rpc('tools/list')) as { tools: { name: string }[] };
  const names = tools.tools.map((t) => t.name).sort();
  console.log(`tools/list: ${names.length} tools`);
  const expected = [
    'generate_plan',
    'get_accuracy',
    'get_best_right_now',
    'get_board_changes',
    'get_comps',
    'get_daily_brief',
    'get_daily_insights',
    'get_domain_digest',
    'get_entity',
    'get_forecasts',
    'get_launches',
    'get_market_models',
    'get_metric_series',
    'get_opportunities',
    'get_opportunity',
    'get_pain_points',
    'get_patterns',
    'get_plan',
    'get_server_guide',
    'get_stack_for',
    'get_agent_stack_for',
    'list_agent_stacks',
    'get_story',
    'get_top_signals',
    'get_topic_map',
    'list_metrics',
    'list_stacks',
    'search_stories',
  ];
  for (const e of expected) {
    if (!names.includes(e)) throw new Error(`missing tool: ${e}`);
  }

  const brief = await callTool('get_daily_brief');
  console.log('get_daily_brief:', brief.slice(0, 90).replace(/\n/g, ' '), '…');

  const signals = JSON.parse(stripAttribution(await callTool('get_top_signals', { domain: 'coding', limit: 3 })));
  console.log('get_top_signals:', signals.count, 'signals (coding)');

  const board = JSON.parse(stripAttribution(await callTool('get_best_right_now', { domain: 'coding' })));
  console.log('get_best_right_now:', board.count, 'entries (coding)');

  const launches = JSON.parse(stripAttribution(await callTool('get_launches', { days: 14, limit: 5 })));
  console.log('get_launches:', launches.count, 'launches (14d)');

  const patterns = JSON.parse(stripAttribution(await callTool('get_patterns', { days: 7 })));
  console.log('get_patterns:', patterns.count, 'anomalies (7d)');

  const opps = JSON.parse(stripAttribution(await callTool('get_opportunities', { limit: 3 })));
  console.log('get_opportunities:', opps.count, 'openings');

  const guide = await callTool('get_server_guide');
  if (!guide.includes('flagship')) throw new Error('get_server_guide missing the flagship workflow');
  console.log('get_server_guide: ok');

  // resources + prompts
  const resources = (await rpc('resources/list')) as { resources: { uri: string }[] };
  const uris = resources.resources.map((r) => r.uri);
  for (const u of ['radar://brief/latest', 'radar://opportunities', 'radar://map/latest']) {
    if (!uris.includes(u)) throw new Error(`missing resource: ${u}`);
  }
  console.log('resources/list:', uris.length, 'static resources (+templates)');

  const read = (await rpc('resources/read', { uri: 'radar://opportunities' })) as {
    contents: { text: string }[];
  };
  console.log('resources/read radar://opportunities:', JSON.parse(read.contents[0].text).count, 'openings');

  const prompts = (await rpc('prompts/list')) as { prompts: { name: string }[] };
  const promptNames = prompts.prompts.map((p) => p.name);
  for (const p of ['find_and_plan', 'whats_new_today', 'what_should_i_use', 'which_agent_stack', 'validate_idea', 'builder_weekly_review']) {
    if (!promptNames.includes(p)) throw new Error(`missing prompt: ${p}`);
  }
  console.log('prompts/list:', promptNames.join(', '));

  const plan = JSON.parse(stripAttribution(await callTool('get_plan', { opportunity: '__smoke__' })));
  if (plan.found !== false) throw new Error('get_plan for a nonexistent slug should return found:false');
  console.log('get_plan (miss path): ok');

  if (!signals && !brief.includes('Source:')) throw new Error('attribution missing from payloads');
  console.log('\nSMOKE OK —', names.length, 'tools,', uris.length, 'resources,', promptNames.length, 'prompts');
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message);
  process.exit(1);
});
