/**
 * Smoke test for the MCP server — raw JSON-RPC over HTTP, no SDK client.
 * Usage: npx tsx mcp/test/smoke.ts [baseUrl]   (default http://127.0.0.1:3122)
 * Requires the server running (npm run mcp) and a seeded database.
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:3122';

let id = 0;
async function rpc(method: string, params: unknown = {}): Promise<unknown> {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
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

async function main() {
  try {
    const health = await fetch(`${BASE}/health`).then((r) => r.json());
    console.log('health:', JSON.stringify(health));
  } catch {
    console.log('health: (not exposed on this URL — internal endpoint, skipping)');
  }

  await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'radar-smoke', version: '0.1.0' },
  });
  console.log('initialize: ok');

  const tools = (await rpc('tools/list')) as { tools: { name: string }[] };
  const names = tools.tools.map((t) => t.name).sort();
  console.log('tools/list:', names.join(', '));
  const expected = ['get_best_right_now', 'get_daily_brief', 'get_opportunities', 'get_stack_for', 'get_top_signals'];
  for (const e of expected) {
    if (!names.includes(e)) throw new Error(`missing tool: ${e}`);
  }

  const brief = await callTool('get_daily_brief');
  console.log('get_daily_brief:', brief.slice(0, 90).replace(/\n/g, ' '), '…');

  const signals = await callTool('get_top_signals', { domain: 'coding', limit: 3 });
  const parsedSignals = JSON.parse(signals.split('\n\n—\n')[0]);
  console.log('get_top_signals:', parsedSignals.count, 'signals (coding)');

  const board = await callTool('get_best_right_now', { domain: 'coding' });
  console.log('get_best_right_now:', JSON.parse(board.split('\n\n—\n')[0]).count, 'entries (coding)');

  const stack = await callTool('get_stack_for', { venture: 'saas-b2b' });
  console.log('get_stack_for:', stack.slice(0, 80).replace(/\n/g, ' '), '…');

  const opps = await callTool('get_opportunities', { limit: 3 });
  console.log('get_opportunities:', JSON.parse(opps.split('\n\n—\n')[0]).count, 'openings');

  if (!signals.includes('Source:')) throw new Error('attribution missing from payload');
  console.log('\nSMOKE OK — 5 tools live, attribution present');
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message);
  process.exit(1);
});
