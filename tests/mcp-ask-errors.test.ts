import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/llm/minimax', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/minimax')>();
  return { ...actual, chatJSON: vi.fn() };
});

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerAskTools } from '../mcp/tools/ask';
import { chatJSON } from '@/lib/llm/minimax';
import { seedUser, useTestDb } from './helpers/db';

const mockChat = chatJSON as unknown as Mock;

// G6: a raw LLM provider error must never reach the MCP client — the payload
// carries a stable message, the real error is logged server-side (same
// mapping as the phase-3 /api/debates route).
const PROVIDER_ERROR =
  'MiniMax HTTP 401 from https://api.minimax.internal/v1/chat/completions: invalid api key sk-live-secret-123';

function authFor(userId: number | null): AuthContext {
  return {
    authed: userId != null,
    userId,
    scopes: new Set(['read']),
    rateKey: userId != null ? `user:${userId}` : 'ip:test',
  };
}

async function wire(auth: AuthContext): Promise<Client> {
  const server = new McpServer({ name: 'ask-test', version: '0.0.1' });
  registerAskTools(server, auth);
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

interface AskPayload {
  ok: boolean;
  error?: string;
  citations: { label: string; url?: string }[];
}

describe('ask_radar provider-error mapping', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useTestDb();
    mockChat.mockReset();
    mockChat.mockRejectedValue(new Error(PROVIDER_ERROR));
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  function expectStable(p: AskPayload): void {
    expect(p.ok).toBe(false);
    expect(p.error).toBe('ask failed — try again shortly');
    const wireText = JSON.stringify(p);
    expect(wireText).not.toContain('sk-live');
    expect(wireText).not.toContain('401');
    expect(wireText).not.toContain('minimax.internal');
  }

  it('anonymous caller gets the stable message; the real error is logged server-side', async () => {
    const client = await wire(authFor(null));
    const res = await client.callTool({
      name: 'ask_radar',
      arguments: { question: 'Which opportunities fit a solo devtools founder?' },
    });
    expectStable(res.structuredContent as unknown as AskPayload);
    expect(errSpy).toHaveBeenCalledWith(
      '[mcp/ask_radar] synthesis call failed:',
      expect.objectContaining({ message: PROVIDER_ERROR }),
    );
  });

  it('authed caller gets the stable message too', async () => {
    const db = useTestDb();
    seedUser(db, 1);
    const client = await wire(authFor(1));
    const res = await client.callTool({
      name: 'ask_radar',
      arguments: { question: 'What should I build for ecommerce operators?' },
    });
    expectStable(res.structuredContent as unknown as AskPayload);
    expect(errSpy).toHaveBeenCalledWith(
      '[mcp/ask_radar] synthesis call failed:',
      expect.objectContaining({ message: PROVIDER_ERROR }),
    );
  });
});
