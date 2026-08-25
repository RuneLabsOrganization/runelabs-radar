import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { _setFetch } from '@/lib/llm/minimax';
import {
  boardHistory,
  launches,
  llmCalls,
  metricPoints,
  opportunities,
  patterns,
  reports,
  stories,
} from '@/lib/db/schema';
import { runWeeklyReport, weekSunday } from '@/lib/brief/weekly';
import { registerWeeklyTools } from '../mcp/tools/weekly';
import type { AuthContext } from '../mcp/lib/auth';
import { useTestDb } from './helpers/db';

let db: ReturnType<typeof useTestDb>;

const savedEnv = { key: process.env.MINIMAX_API_KEY };

const AUTH: AuthContext = {
  authed: false,
  userId: null,
  scopes: new Set(['read', 'plans']),
  rateKey: 'test',
};

beforeEach(() => {
  db = useTestDb();
  // chatJSON refuses to call out without a key; the fetch below is mocked anyway
  process.env.MINIMAX_API_KEY = 'test-key';
});

afterEach(() => {
  _setFetch(globalThis.fetch);
  if (savedEnv.key === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = savedEnv.key;
});

/** Mock fetch answering every chat completion with the given markdown payload. */
function mockCompletion(markdown: string, capture?: { user?: string }): void {
  _setFetch((async (_url: unknown, init: { body: string }) => {
    if (capture) {
      const body = JSON.parse(init.body) as { messages: { content: string }[] };
      capture.user = body.messages[1]!.content;
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ markdown }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    } as Response;
  }) as unknown as typeof fetch);
}

function day(n: number): string {
  return new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
}

/** One of every input the report assembles from. */
function seedWeek(): void {
  const now = new Date();
  db.insert(stories)
    .values({
      title: 'Open model undercuts frontier coding prices',
      tldr: 'A new open weights model matches frontier coding at a tenth of the price.',
      topScore: 82,
      status: 'curated',
      createdAt: now,
    })
    .run();
  db.insert(boardHistory)
    .values({ domain: 'coding', task: 'app builder', change: 'best_overall: old-model -> new-model', appliedAt: now })
    .run();
  db.insert(opportunities)
    .values({
      slug: 'bulk-bg-removal-api',
      title: 'Bulk background-removal API',
      thesis: 'Sellers need cheap bulk background removal; new image models make it 10x cheaper.',
      sector: 'ai-media',
      status: 'active',
      flipScore: 72,
      holdScore: 55,
      scores: '{}',
      evidence: '[]',
      verdict: 'pursue',
      confidence: 60,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .run();
  db.insert(launches)
    .values({ source: 'show-hn', title: 'Launch A', url: 'https://a.example', category: 'ai-coding', launchedAt: now, createdAt: now })
    .run();
  db.insert(launches)
    .values({ source: 'show-hn', title: 'Launch B', url: 'https://b.example', category: 'ai-coding', launchedAt: now, createdAt: now })
    .run();
  db.insert(patterns)
    .values({
      kind: 'price-drop',
      subject: 'new-model',
      headline: 'new-model blended price fell 40%',
      detail: 'Provider pricing page updated mid-week.',
      score: 3.2,
      evidence: '[]',
      date: day(0),
      createdAt: now,
    })
    .run();
  // first-party mover: baseline 10d ago, latest in-window (+50%)
  db.insert(metricPoints)
    .values({ source: 'github', entity: 'org/repo', metric: 'stars', value: 1000, date: day(10), createdAt: now })
    .run();
  db.insert(metricPoints)
    .values({ source: 'github', entity: 'org/repo', metric: 'stars', value: 1500, date: day(0), createdAt: now })
    .run();
  // AA-sourced series must never reach the prompt
  db.insert(metricPoints)
    .values({ source: 'aa', entity: 'aa-only-model', metric: 'intelligence', value: 40, date: day(10), createdAt: now })
    .run();
  db.insert(metricPoints)
    .values({ source: 'aa', entity: 'aa-only-model', metric: 'intelligence', value: 60, date: day(0), createdAt: now })
    .run();
}

async function wireWeekly(): Promise<Client> {
  const server = new McpServer({ name: 'weekly-test', version: '0.0.1' });
  registerWeeklyTools(server, AUTH);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-test', version: '0.0.1' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function callTool(client: Client, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name: 'get_weekly_report', arguments: args })) as {
    structuredContent?: Record<string, unknown>;
  };
}

describe('weekSunday', () => {
  it('returns a Sunday (YYYY-MM-DD UTC)', () => {
    const d = weekSunday();
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${d}T00:00:00Z`).getUTCDay()).toBe(0);
  });

  it('maps any weekday to the Sunday opening its week', () => {
    // Wednesday 2026-08-19 → Sunday 2026-08-16; a Sunday maps to itself
    expect(weekSunday(new Date('2026-08-19T12:00:00Z'))).toBe('2026-08-16');
    expect(weekSunday(new Date('2026-08-16T12:00:00Z'))).toBe('2026-08-16');
    expect(weekSunday(new Date('2026-08-22T12:00:00Z'))).toBe('2026-08-16');
  });
});

describe('runWeeklyReport', () => {
  it('assembles the week, calls the LLM once and persists the markdown', async () => {
    seedWeek();
    const capture: { user?: string } = {};
    mockCompletion('# State of the Builder Market\n\nA tight weekly issue with several words.', capture);

    const out = await runWeeklyReport();
    expect(out.date).toBe(weekSunday());
    expect(out.words).toBeGreaterThan(0);

    const rows = db.select().from(reports).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe(weekSunday());
    expect(rows[0]!.markdown).toContain('State of the Builder Market');

    // metered as its own feature
    const calls = db.select().from(llmCalls).all();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.feature).toBe('weekly-report');

    // every section's input reached the prompt
    const user = capture.user!;
    expect(user).toContain('Open model undercuts frontier coding prices');
    expect(user).toContain('app builder');
    expect(user).toContain('Bulk background-removal API');
    expect(user).toContain('ai-coding: 2');
    expect(user).toContain('price-drop');
    expect(user).toContain('org/repo');
    // AA-derived series never leak into the report prompt
    expect(user).not.toContain('aa-only-model');
  });

  it('does not leak private pursue openings into the public weekly prompt', async () => {
    seedWeek();
    const now = new Date();
    db.insert(opportunities)
      .values({
        slug: 'alice-secret-opening',
        ownerUserId: 1,
        title: 'SECRET PRIVATE OPENING THAT MUST NOT LEAK',
        thesis: 'A private opening fitted to one builder and never meant for the public radar.',
        sector: 'devtools',
        status: 'active',
        flipScore: 99,
        holdScore: 80,
        scores: '{}',
        evidence: '[]',
        verdict: 'pursue',
        confidence: 80,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .run();
    const capture: { user?: string } = {};
    mockCompletion('# State of the Builder Market\n\nA tight weekly issue with several words.', capture);
    await runWeeklyReport();
    expect(capture.user).toContain('Bulk background-removal API');
    expect(capture.user).not.toContain('SECRET PRIVATE OPENING THAT MUST NOT LEAK');
  });

  it('re-running the same Sunday upserts — one row, updated markdown', async () => {
    seedWeek();
    mockCompletion('# State of the Builder Market\n\nFirst edition.');
    await runWeeklyReport();
    mockCompletion('# State of the Builder Market\n\nSecond edition, rewritten.');
    const out = await runWeeklyReport();

    const rows = db.select().from(reports).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.markdown).toContain('Second edition');
    expect(out.date).toBe(rows[0]!.date);
  });

  it('writes nothing and reports 0 words when the LLM call fails', async () => {
    seedWeek();
    // 400 = non-retryable LlmError, no backoff wait
    _setFetch((async () => ({ ok: false, status: 400 })) as unknown as typeof fetch);
    const out = await runWeeklyReport();
    expect(out.words).toBe(0);
    expect(db.select().from(reports).all()).toHaveLength(0);
  });

  it('writes a static quiet-week issue without an LLM call when nothing happened', async () => {
    const out = await runWeeklyReport();
    expect(out.words).toBeGreaterThan(0);
    expect(out.calls).toBe(0);
    const rows = db.select().from(reports).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.markdown).toContain('Quiet week');
  });
});

describe('get_weekly_report tool', () => {
  function seedReport(date: string, markdown: string): void {
    db.insert(reports).values({ date, markdown, createdAt: new Date(`${date}T08:00:00Z`) }).run();
  }

  it('returns the latest issue when no date is given', async () => {
    seedReport('2026-08-09', '# Older issue');
    seedReport('2026-08-16', '# Latest issue\n\nNewest words here.');
    const client = await wireWeekly();
    // markdown only ships at detail=full; compact (the default) returns excerpt
    const res = await callTool(client, { detail: 'full' });
    expect(res.structuredContent?.found).toBe(true);
    expect(res.structuredContent?.date).toBe('2026-08-16');
    expect(res.structuredContent?.markdown).toContain('Latest issue');
    expect(res.structuredContent?.words).toBeGreaterThan(0);
  });

  it('returns a specific issue by date', async () => {
    seedReport('2026-08-09', '# Older issue');
    seedReport('2026-08-16', '# Latest issue');
    const client = await wireWeekly();
    const res = await callTool(client, { date: '2026-08-09', detail: 'full' });
    expect(res.structuredContent?.found).toBe(true);
    expect(res.structuredContent?.date).toBe('2026-08-09');
    expect(res.structuredContent?.markdown).toContain('Older issue');
  });

  it('politely reports found:false for an unknown date and an empty archive', async () => {
    seedReport('2026-08-16', '# Latest issue');
    const client = await wireWeekly();
    const miss = await callTool(client, { date: '2026-08-02' });
    expect(miss.structuredContent?.found).toBe(false);
    expect(miss.structuredContent?.markdown).toBeUndefined();

    const empty = await wireWeekly();
    // fresh DB with no reports at all
    db.delete(reports).where(eq(reports.date, '2026-08-16')).run();
    const none = await callTool(empty);
    expect(none.structuredContent?.found).toBe(false);
  });
});
