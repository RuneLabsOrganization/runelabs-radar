'use client';

// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import { useState } from 'react';

/**
 * Connection health check for the /connect page: a visitor-facing MCP
 * handshake against this origin's /mcp endpoint (initialize → tools/list).
 * No token is ever accepted, sent, or stored — in auth-required mode the
 * expected healthy answer for a tokenless visitor is a 401, and the UI
 * says so plainly.
 *
 * The network core is exported pure (fetch/timeout injectable) so
 * tests/connect-health.test.ts can drive it without a DOM or a server.
 */

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const HEALTH_TIMEOUT_MS = 8000;

export type HealthResult =
  | { kind: 'connected'; latencyMs: number; serverName: string; serverVersion: string; toolCount: number }
  | { kind: 'auth-required'; latencyMs: number }
  | { kind: 'unreachable'; detail: string }
  | { kind: 'unexpected'; latencyMs: number | null; detail: string };

interface JsonRpcReply {
  result?: {
    serverInfo?: { name?: unknown; version?: unknown };
    tools?: unknown;
  };
  error?: { code?: unknown; message?: unknown };
}

/** Parse one streamable-HTTP reply body: SSE frame(s) or plain JSON. On SSE,
 *  the JSON-RPC message is the last `data:` line (same rule as mcp/test/smoke.ts). */
export function parseRpcReply(text: string): JsonRpcReply {
  const trimmed = text.trim();
  const dataLines = trimmed.split('\n').filter((l) => l.startsWith('data:'));
  const payload = dataLines.length > 0 ? dataLines[dataLines.length - 1].slice(5).trim() : trimmed;
  if (!payload) throw new SyntaxError('empty reply');
  return JSON.parse(payload) as JsonRpcReply;
}

export function rpcBody(id: number, method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

const REQUEST_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': MCP_PROTOCOL_VERSION,
};

export async function runHealthCheck(
  endpoint: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<HealthResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = performance.now();
  let latencyMs: number | null = null;
  try {
    const initRes = await fetchImpl(endpoint, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: rpcBody(1, 'initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'radar-connect-health', version: '1.0.0' },
      }),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    latencyMs = Math.round(performance.now() - started);

    // MCP_AUTH_REQUIRED mode: the healthy answer for a visitor with no token.
    if (initRes.status === 401) return { kind: 'auth-required', latencyMs };
    if (!initRes.ok) return { kind: 'unexpected', latencyMs, detail: `HTTP ${initRes.status} on initialize` };

    const initMsg = parseRpcReply(await initRes.text());
    if (initMsg.error) return { kind: 'unexpected', latencyMs, detail: rpcErrorDetail(initMsg) };
    const serverInfo = initMsg.result?.serverInfo;
    if (!serverInfo || typeof serverInfo.name !== 'string') {
      return { kind: 'unexpected', latencyMs, detail: 'initialize reply carried no serverInfo' };
    }

    const listRes = await fetchImpl(endpoint, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: rpcBody(2, 'tools/list', {}),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!listRes.ok) return { kind: 'unexpected', latencyMs, detail: `HTTP ${listRes.status} on tools/list` };
    const listMsg = parseRpcReply(await listRes.text());
    if (listMsg.error) return { kind: 'unexpected', latencyMs, detail: rpcErrorDetail(listMsg) };
    if (!Array.isArray(listMsg.result?.tools)) {
      return { kind: 'unexpected', latencyMs, detail: 'tools/list reply carried no tools array' };
    }

    return {
      kind: 'connected',
      latencyMs,
      serverName: serverInfo.name,
      serverVersion: typeof serverInfo.version === 'string' ? serverInfo.version : '?',
      toolCount: listMsg.result.tools.length,
    };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'AbortError') {
      return { kind: 'unreachable', detail: `no answer within ${Math.round(timeoutMs / 1000)}s — timed out` };
    }
    if (err instanceof SyntaxError) {
      return { kind: 'unexpected', latencyMs, detail: 'the reply was not MCP JSON-RPC' };
    }
    return { kind: 'unreachable', detail: 'network error — nothing answered at this URL' };
  } finally {
    clearTimeout(timer);
  }
}

function rpcErrorDetail(msg: JsonRpcReply): string {
  const code = typeof msg.error?.code === 'number' ? msg.error.code : '?';
  const message = typeof msg.error?.message === 'string' ? msg.error.message : 'unknown error';
  return `JSON-RPC error ${code}: ${message}`;
}

function ResultView({ result }: { result: HealthResult }) {
  const okColor = 'var(--phosphor)';
  const badColor = 'var(--alert)';
  switch (result.kind) {
    case 'connected':
      return (
        <>
          <div>
            <span style={{ color: okColor }}>●</span>{' '}
            <strong style={{ color: okColor }}>CONNECTED</strong>
            <span style={{ color: 'var(--ink-4)' }}> — handshake {result.latencyMs}ms round-trip</span>
          </div>
          <div className="mt-1" style={{ color: 'var(--ink-3)' }}>
            server {result.serverName} v{result.serverVersion} · {result.toolCount} tools listed
          </div>
        </>
      );
    case 'auth-required':
      return (
        <>
          <div>
            <span style={{ color: okColor }}>●</span>{' '}
            <strong style={{ color: okColor }}>REACHABLE — AUTH REQUIRED</strong>
            <span style={{ color: 'var(--ink-4)' }}> — {result.latencyMs}ms round-trip</span>
          </div>
          <div className="mt-1" style={{ color: 'var(--ink-3)' }}>
            The server is up and asking for auth — that means it&apos;s working. A visitor without a
            token gets this 401 by design; your MCP client will open a login/consent screen on first
            connect. This check never sends or stores a token.
          </div>
        </>
      );
    case 'unreachable':
      return (
        <>
          <div>
            <span style={{ color: badColor }}>●</span>{' '}
            <strong style={{ color: badColor }}>UNREACHABLE</strong>
          </div>
          <div className="mt-1" style={{ color: 'var(--ink-3)' }}>
            {result.detail}. This check calls the /mcp endpoint on the origin you&apos;re browsing —
            on a self-host dev box without the reverse proxy, the MCP process listens on its own
            port (default http://127.0.0.1:3122/mcp) and this page can&apos;t see it.
          </div>
        </>
      );
    case 'unexpected':
      return (
        <>
          <div>
            <span style={{ color: badColor }}>●</span>{' '}
            <strong style={{ color: badColor }}>UNEXPECTED REPLY</strong>
            {result.latencyMs !== null && (
              <span style={{ color: 'var(--ink-4)' }}> — {result.latencyMs}ms round-trip</span>
            )}
          </div>
          <div className="mt-1" style={{ color: 'var(--ink-3)' }}>
            Something answered, but it doesn&apos;t look like this Radar&apos;s MCP server:{' '}
            {result.detail}.
          </div>
        </>
      );
  }
}

export default function ConnectHealth() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HealthResult | null>(null);

  async function check() {
    if (running) return;
    setRunning(true);
    setResult(null);
    try {
      setResult(await runHealthCheck(`${window.location.origin}/mcp`));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card !p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-2)]">
          Connection health
        </div>
        <button type="button" onClick={check} disabled={running} className="btn">
          {running ? 'checking…' : 'run check'}
        </button>
      </div>
      <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-4)' }}>
        Handshakes from your browser with this origin&apos;s /mcp endpoint (initialize → tools/list).
        No token is sent or stored.
      </p>
      {result && (
        <div
          className="mono mt-2 rounded-[4px] border border-[var(--grat)] bg-[var(--scope-2)] p-3 text-[11.5px] leading-relaxed text-[var(--ink-2)]"
          aria-live="polite"
        >
          <ResultView result={result} />
        </div>
      )}
    </div>
  );
}
