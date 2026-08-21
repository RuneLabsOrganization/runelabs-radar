import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { _setFetch, drainLlmUsageStats } from '@/lib/llm/minimax';
import { HARNESS_LANDSCAPE, PE_LOVED_PUBLISHED, REST_OF_FIELD, agentStackPoints } from '@/lib/agent-stacks';
import { publishedAgentStacks, sanitizeAgentStackDraft, syncAgentStacks } from '@/lib/agent-stacks-sync';
import { agentStackState, llmCalls } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';

let db: ReturnType<typeof useTestDb>;
const savedEnv = { mini: process.env.MINIMAX_API_KEY, brave: process.env.BRAVE_API_KEY };

beforeEach(() => {
  db = useTestDb();
  process.env.MINIMAX_API_KEY = '';
  process.env.BRAVE_API_KEY = '';
});

afterEach(() => {
  _setFetch(globalThis.fetch);
  if (savedEnv.mini === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = savedEnv.mini;
  if (savedEnv.brave === undefined) delete process.env.BRAVE_API_KEY;
  else process.env.BRAVE_API_KEY = savedEnv.brave;
});

describe('sanitizeAgentStackDraft', () => {
  it('locks PE loved % even when the draft tries to move them', () => {
    const out = sanitizeAgentStackDraft({
      landscape: [
        { name: 'Claude Code', lovedPct: 90, role: 'still the CLI', loses: 'no Tab', sticker: '$20' },
        { name: 'Cursor', lovedPct: 1, role: 'GUI', loses: 'credits', sticker: '$20' },
        { name: 'Codex', lovedPct: 12, role: 'fast daily', loses: 'design', sticker: '$20' },
      ],
      personas: [{ slug: 'daily', stack: 'Cursor Pro + Claude Pro', costLowUsd: 40, costHighUsd: 40, why: 'two seats', skip: 'Windsurf' }],
      pairings: [
        { job: 'Daily', model: 'Composer', harness: 'Cursor' },
        { job: 'Design', model: 'Opus', harness: 'Claude Code' },
        { job: 'Mechanical', model: 'Grok 4.6', harness: 'Cursor' },
      ],
    });
    expect(out).not.toBeNull();
    expect(out!.landscape.find((h) => h.name === 'Claude Code')?.lovedPct).toBe(PE_LOVED_PUBLISHED['Claude Code']);
    expect(out!.landscape.find((h) => h.name === 'Cursor')?.lovedPct).toBe(PE_LOVED_PUBLISHED.Cursor);
    expect(out!.landscape.find((h) => h.name === 'Codex')?.lovedPct).toBe(12);
    expect(out!.landscape.reduce((s, h) => s + h.lovedPct, 0)).toBe(100);
    expect(out!.personas.find((p) => p.slug === 'daily')?.stack).toContain('Cursor Pro');
    expect(out!.landscape.every((h) => h.aliases.length > 0)).toBe(true);
  });

  it('drops unknown harnesses and keeps seed aliases/kind', () => {
    const out = sanitizeAgentStackDraft({
      landscape: [{ name: 'MadeUpIDE', lovedPct: 50, role: 'nope', loses: 'nope', sticker: '$1' }],
    });
    expect(out!.landscape.map((h) => h.name).sort()).toEqual([...HARNESS_LANDSCAPE.map((h) => h.name)].sort());
    expect(out!.landscape.find((h) => h.name === REST_OF_FIELD)?.lovedPct).toBeGreaterThan(0);
  });

  it('rejects non-objects', () => {
    expect(sanitizeAgentStackDraft(null)).toBeNull();
    expect(sanitizeAgentStackDraft('nope')).toBeNull();
  });
});

function mockCompletion(payload: unknown, usage = { prompt_tokens: 2100, completion_tokens: 1500 }): void {
  _setFetch((async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage }),
  })) as unknown as typeof fetch);
}

describe('syncAgentStacks LLM metering', () => {
  it('writes one llm_calls row tagged job+feature agent-stacks', async () => {
    process.env.MINIMAX_API_KEY = 'test-key';
    process.env.BRAVE_API_KEY = '';
    drainLlmUsageStats();
    mockCompletion({
      rationale: 'Brave was quiet; keep the seed.',
      personas: [],
      landscape: [],
      pairings: [
        { job: 'Daily', model: 'Composer', harness: 'Cursor' },
        { job: 'Design', model: 'Opus', harness: 'Claude Code' },
        { job: 'Mechanical', model: 'Grok', harness: 'Cursor' },
      ],
    });

    const res = await syncAgentStacks();
    expect(res.llmSkipped).toBe(false);
    expect(res.updated).toBe(true);
    expect(res.braveSkipped).toBe(true);
    expect(res.calls).toBe(1);
    expect(res.recorded).toBe(agentStackPoints().length);

    const rows = db.select().from(llmCalls).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.feature).toBe('agent-stacks');
    expect(rows[0]!.job).toBe('agent-stacks');
    expect(rows[0]!.promptTokens).toBe(2100);
    expect(rows[0]!.completionTokens).toBe(1500);
    expect(rows[0]!.estCostUsd).toBeCloseTo(0.00243, 12);

    const state = db.select().from(agentStackState).where(eq(agentStackState.id, 1)).get();
    expect(state?.rationale).toBe('Brave was quiet; keep the seed.');
    expect(publishedAgentStacks().landscape[0]!.name).toBe('Claude Code');
  });
});
