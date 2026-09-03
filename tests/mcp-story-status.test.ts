import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerSignalTools } from '../mcp/tools/signals';
import { stories } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

/**
 * G3 regression: get_story used to return a story of ANY status by id, so
 * enumerating ids leaked pre-publication (raw / filtered-out) stories. It now
 * filters to status='curated', matching get_top_signals / search_stories.
 */

let db: Db;

async function wire(): Promise<Client> {
  const server = new McpServer({ name: 'story-status-test', version: '0.0.1' });
  registerSignalTools(server); // no auth wiring: read tools stay open in self-host
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

function seedStory(title: string, status: 'raw' | 'filtered' | 'curated'): number {
  return db
    .insert(stories)
    .values({ title, status, topScore: 50, createdAt: new Date() })
    .returning({ id: stories.id })
    .get()!.id;
}

beforeEach(() => {
  db = useTestDb();
});

describe('get_story status filter', () => {
  it('does not expose raw stories by id', async () => {
    const id = seedStory('Unreviewed wire dump', 'raw');
    const client = await wire();
    const res = (await client.callTool({ name: 'get_story', arguments: { id } })) as {
      structuredContent?: { found: boolean };
    };
    expect(res.structuredContent!.found).toBe(false);
  });

  it('does not expose filtered-out stories by id', async () => {
    const id = seedStory('Rejected at curation', 'filtered');
    const client = await wire();
    const res = (await client.callTool({ name: 'get_story', arguments: { id } })) as {
      structuredContent?: { found: boolean };
    };
    expect(res.structuredContent!.found).toBe(false);
  });

  it('still serves curated stories in full', async () => {
    const id = seedStory('Published signal', 'curated');
    const client = await wire();
    const res = (await client.callTool({ name: 'get_story', arguments: { id } })) as {
      structuredContent?: { found: boolean; story?: { id: number; title: string } };
    };
    expect(res.structuredContent!.found).toBe(true);
    expect(res.structuredContent!.story).toMatchObject({ id, title: 'Published signal' });
  });
});
