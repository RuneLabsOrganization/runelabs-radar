import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerBatchTools } from '../mcp/tools/batches';
import { registerJobTools } from '../mcp/tools/jobs';
import { registerOpportunityTools } from '../mcp/tools/opportunities';
import { registerSignalTools } from '../mcp/tools/signals';
import { createWorkspaceBatch } from '@/lib/batches';
import { seedUser, useTestDb } from './helpers/db';

/**
 * Scope enforcement (OAuth 2.1): the consent screen advertises read / plans /
 * batches — every one must gate something. Batch WRITES require 'batches';
 * read tools require 'read'. Anonymous self-host contexts hold every scope
 * (see authenticate), so only OAuth tokens can trip these gates.
 */

function authFor(userId: number | null, scopes: string[]): AuthContext {
  return { authed: userId != null, userId, scopes: new Set(scopes), rateKey: `user:${userId ?? 'anon'}` };
}

type Register = (server: McpServer, auth: AuthContext) => void;

async function wire(register: Register, auth: AuthContext): Promise<Client> {
  const server = new McpServer({ name: 'scopes-test', version: '0.0.1' });
  register(server, auth);
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as {
    structuredContent?: Record<string, unknown>;
  };
}

beforeEach(() => {
  const db = useTestDb();
  seedUser(db, 1);
});

describe('batch write tools require the batches scope', () => {
  it('create_batch rejects a token without the batches scope and says why', async () => {
    const client = await wire(registerBatchTools, authFor(1, ['read']));
    const res = await call(client, 'create_batch', { title: 'My batch' });
    expect(res.structuredContent).toMatchObject({ ok: false });
    expect(res.structuredContent!.error).toContain("'batches' scope");
  });

  it('create_batch works with the batches scope', async () => {
    const client = await wire(registerBatchTools, authFor(1, ['read', 'batches']));
    const res = await call(client, 'create_batch', { title: 'My batch' });
    expect(res.structuredContent).toMatchObject({ ok: true });
    expect(res.structuredContent!.slug).toEqual(expect.any(String));
  });

  it('add_to_batch rejects the batch owner when the token lacks the batches scope', async () => {
    const batch = createWorkspaceBatch(1, 'Owned');
    const client = await wire(registerBatchTools, authFor(1, ['read']));
    const res = await call(client, 'add_to_batch', {
      slug: batch.slug,
      ref_type: 'idea',
      idea_text: 'an idea',
    });
    expect(res.structuredContent).toMatchObject({ ok: false });
    expect(res.structuredContent!.error).toContain("'batches' scope");
  });

  it('add_to_batch works with the batches scope', async () => {
    const batch = createWorkspaceBatch(1, 'Owned');
    const client = await wire(registerBatchTools, authFor(1, ['read', 'batches']));
    const res = await call(client, 'add_to_batch', {
      slug: batch.slug,
      ref_type: 'idea',
      idea_text: 'an idea',
    });
    expect(res.structuredContent).toMatchObject({ ok: true });
  });

  it('run_batch rejects the batch owner when the token lacks the batches scope', async () => {
    const batch = createWorkspaceBatch(1, 'Owned');
    const client = await wire(registerBatchTools, authFor(1, ['read']));
    const res = await call(client, 'run_batch', { slug: batch.slug, op: 'debate' });
    expect(res.structuredContent).toMatchObject({ ok: false });
    expect(res.structuredContent!.error).toContain("'batches' scope");
  });

  it('run_batch with the batches scope gets past the scope gate', async () => {
    const client = await wire(registerBatchTools, authFor(1, ['read', 'batches']));
    // unknown slug: the 'not found' refusal proves the scope gate passed
    const res = await call(client, 'run_batch', { slug: 'no-such-batch', op: 'debate' });
    expect(res.structuredContent).toMatchObject({ ok: false });
    expect(res.structuredContent!.error).not.toContain("'batches' scope");
  });
});

describe('batch read tools require only the read scope', () => {
  it('list_batches / get_batch / get_batch_run work with read', async () => {
    const batch = createWorkspaceBatch(1, 'Readable');
    const client = await wire(registerBatchTools, authFor(1, ['read']));

    const list = await call(client, 'list_batches');
    expect(list.structuredContent).toMatchObject({ count: 1 });

    const get = await call(client, 'get_batch', { slug: batch.slug });
    expect(get.structuredContent).toMatchObject({ found: true });
    expect(get.structuredContent!.summary).not.toContain("'read' scope");

    const run = await call(client, 'get_batch_run', { run_id: 999 });
    expect(run.structuredContent).toMatchObject({ found: false });
    expect(run.structuredContent!.summary).not.toContain("'read' scope");
  });
});

describe('read tools across the surface require the read scope', () => {
  it('whats_relevant without read returns empty sections and says why', async () => {
    const client = await wire(registerJobTools, authFor(1, []));
    const res = await call(client, 'whats_relevant', { project: 'a batch image pipeline for shops' });
    expect(res.structuredContent).toMatchObject({ signals: [], opportunities: [], pains: [], board_hints: [] });
    expect(res.structuredContent!.summary).toContain("'read' scope");
  });

  it('whats_relevant with read works', async () => {
    const client = await wire(registerJobTools, authFor(1, ['read']));
    const res = await call(client, 'whats_relevant', { project: 'a batch image pipeline for shops' });
    expect(res.structuredContent!.summary).not.toContain("'read' scope");
  });

  it('get_opportunities without read is denied', async () => {
    const client = await wire(registerOpportunityTools, authFor(null, []));
    const res = await call(client, 'get_opportunities', { limit: 3 });
    expect(res.structuredContent).toMatchObject({ count: 0, opportunities: [] });
    expect(res.structuredContent!.summary).toContain("'read' scope");
  });

  it('get_story without read is denied when auth is wired in', async () => {
    const client = await wire(registerSignalTools, authFor(null, []));
    const res = await call(client, 'get_story', { id: 1 });
    expect(res.structuredContent).toMatchObject({ found: false });
    expect(res.structuredContent!.summary).toContain("'read' scope");
  });
});

describe('anonymous self-host contexts (every scope) are unaffected', () => {
  it('create_batch still reaches the auth check instead of a scope denial', async () => {
    const anon = authFor(null, ['read', 'plans', 'batches']);
    const client = await wire(registerBatchTools, anon);
    const res = await call(client, 'create_batch', { title: 'Anon batch' });
    expect(res.structuredContent).toMatchObject({ ok: false, error: 'auth required' });
  });
});
