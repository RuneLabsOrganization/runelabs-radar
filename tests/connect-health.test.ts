/**
 * ConnectHealth core logic — the browser-side MCP handshake behind the
 * /connect "run check" button (initialize → tools/list against /mcp).
 * No DB, no server: fetch is injected as a stub.
 */
import { describe, it, expect } from 'vitest';
import {
  parseRpcReply,
  rpcBody,
  runHealthCheck,
  MCP_PROTOCOL_VERSION,
  type HealthResult,
} from '@/components/ConnectHealth';

interface CapturedCall {
  url: string;
  init?: RequestInit;
}

/** Stub fetch replaying a scripted list of responses (or thrown errors). */
function stubFetch(script: ({ status?: number; body?: string } | Error)[]) {
  const calls: CapturedCall[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const step = script[i++] ?? new Error('unexpected extra fetch');
    if (step instanceof Error) throw step;
    return new Response(step.body ?? '', { status: step.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const sse = (msg: unknown) => `event: message\ndata: ${JSON.stringify(msg)}\n\n`;

const INIT_OK = {
  jsonrpc: '2.0',
  id: 1,
  result: { protocolVersion: MCP_PROTOCOL_VERSION, serverInfo: { name: 'runelabs-radar', version: '0.2.0' } },
};
const TOOLS_OK = {
  jsonrpc: '2.0',
  id: 2,
  result: { tools: Array.from({ length: 26 }, (_, i) => ({ name: `tool_${i}` })) },
};

describe('parseRpcReply', () => {
  it('parses a plain JSON reply', () => {
    expect(parseRpcReply(JSON.stringify(INIT_OK)).result?.serverInfo?.name).toBe('runelabs-radar');
  });

  it('parses an SSE reply, taking the last data line', () => {
    const text = `event: message\ndata: {"jsonrpc":"2.0","id":0,"result":{}}\n\nevent: message\ndata: ${JSON.stringify(
      TOOLS_OK,
    )}\n\n`;
    const parsed = parseRpcReply(text);
    expect(Array.isArray(parsed.result?.tools)).toBe(true);
  });

  it('throws SyntaxError on empty or non-JSON bodies', () => {
    expect(() => parseRpcReply('')).toThrow(SyntaxError);
    expect(() => parseRpcReply('<html>nope</html>')).toThrow(SyntaxError);
  });
});

describe('rpcBody', () => {
  it('builds a JSON-RPC 2.0 envelope', () => {
    const parsed = JSON.parse(rpcBody(7, 'tools/list', { a: 1 }));
    expect(parsed).toEqual({ jsonrpc: '2.0', id: 7, method: 'tools/list', params: { a: 1 } });
  });
});

describe('runHealthCheck', () => {
  it('reports CONNECTED with server name, version and tool count (SSE replies)', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: sse(INIT_OK) }, { body: sse(TOOLS_OK) }]);
    const r = await runHealthCheck('http://x.test/mcp', { fetchImpl });
    expect(r.kind).toBe('connected');
    if (r.kind !== 'connected') return;
    expect(r.serverName).toBe('runelabs-radar');
    expect(r.serverVersion).toBe('0.2.0');
    expect(r.toolCount).toBe(26);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);

    // two calls: initialize then tools/list, both with the protocol-version header
    expect(calls).toHaveLength(2);
    const methods = calls.map((c) => JSON.parse(String(c.init?.body)).method);
    expect(methods).toEqual(['initialize', 'tools/list']);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['mcp-protocol-version']).toBe(MCP_PROTOCOL_VERSION);
    expect(JSON.parse(String(calls[0].init?.body)).params.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  });

  it('also accepts plain JSON replies', async () => {
    const { fetchImpl } = stubFetch([{ body: JSON.stringify(INIT_OK) }, { body: JSON.stringify(TOOLS_OK) }]);
    const r = await runHealthCheck('http://x.test/mcp', { fetchImpl });
    expect(r.kind).toBe('connected');
  });

  it('reports REACHABLE + auth required on HTTP 401, without a second call', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 401, body: '{"error":"unauthorized"}' }]);
    const r: HealthResult = await runHealthCheck('http://x.test/mcp', { fetchImpl });
    expect(r.kind).toBe('auth-required');
    if (r.kind === 'auth-required') expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(calls).toHaveLength(1);
  });

  it('reports UNREACHABLE on a network error', async () => {
    const { fetchImpl } = stubFetch([new TypeError('fetch failed')]);
    const r = await runHealthCheck('http://x.test/mcp', { fetchImpl });
    expect(r.kind).toBe('unreachable');
    if (r.kind === 'unreachable') expect(r.detail).toContain('network error');
  });

  it('reports UNREACHABLE when the timeout aborts the request', async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        );
      })) as unknown as typeof fetch;
    const r = await runHealthCheck('http://x.test/mcp', { fetchImpl: hang, timeoutMs: 30 });
    expect(r.kind).toBe('unreachable');
    if (r.kind === 'unreachable') expect(r.detail).toContain('timed out');
  });

  it('reports UNEXPECTED on a non-OK HTTP status', async () => {
    const { fetchImpl } = stubFetch([{ status: 502, body: 'bad gateway' }]);
    const r = await runHealthCheck('http://x.test/mcp', { fetchImpl });
    expect(r.kind).toBe('unexpected');
    if (r.kind === 'unexpected') expect(r.detail).toContain('502');
  });

  it('reports UNEXPECTED when the reply is not MCP JSON-RPC', async () => {
    const { fetchImpl } = stubFetch([{ status: 200, body: '<html>a website</html>' }]);
    const r = await runHealthCheck('http://x.test/mcp', { fetchImpl });
    expect(r.kind).toBe('unexpected');
  });

  it('reports UNEXPECTED on a JSON-RPC error reply', async () => {
    const errReply = { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Invalid Request' } };
    const { fetchImpl } = stubFetch([{ body: sse(errReply) }]);
    const r = await runHealthCheck('http://x.test/mcp', { fetchImpl });
    expect(r.kind).toBe('unexpected');
    if (r.kind === 'unexpected') expect(r.detail).toContain('-32600');
  });

  it('reports UNEXPECTED when tools/list carries no tools array', async () => {
    const { fetchImpl } = stubFetch([{ body: sse(INIT_OK) }, { body: sse({ jsonrpc: '2.0', id: 2, result: {} }) }]);
    const r = await runHealthCheck('http://x.test/mcp', { fetchImpl });
    expect(r.kind).toBe('unexpected');
    if (r.kind === 'unexpected') expect(r.detail).toContain('tools');
  });
});
