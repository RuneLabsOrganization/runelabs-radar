import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { _setFetch } from '@/lib/llm/minimax';
import { publishedAgentStacks, syncAgentStacks } from '@/lib/agent-stacks-sync';
import { agentStackState } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';

let db: ReturnType<typeof useTestDb>;
const savedEnv = { mini: process.env.MINIMAX_API_KEY, brave: process.env.BRAVE_API_KEY };
const STALE = new Date('2026-01-01T00:00:00Z');

beforeEach(() => {
  db = useTestDb();
  // no MiniMax key → the LLM refresh is skipped, the overlay must stay as-is
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

function backdateState(): void {
  db.update(agentStackState).set({ updatedAt: STALE }).where(eq(agentStackState.id, 1)).run();
}

function stateUpdatedAt(): Date {
  return db.select().from(agentStackState).where(eq(agentStackState.id, 1)).get()!.updatedAt;
}

describe('agent_stack_state.updatedAt (public refreshedAt)', () => {
  it('stays put when a refresh writes a byte-identical overlay', async () => {
    await syncAgentStacks(); // first persist — creates the row
    backdateState();

    const res = await syncAgentStacks(); // failed/skipped refresh keeps the overlay
    expect(res.updated).toBe(false);

    expect(stateUpdatedAt().getTime()).toBe(STALE.getTime());
    expect(publishedAgentStacks().refreshedAt?.getTime()).toBe(STALE.getTime());
  });

  it('bumps when the payload actually changed', async () => {
    await syncAgentStacks();
    backdateState();

    process.env.MINIMAX_API_KEY = 'test-key';
    _setFetch((async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                rationale: 'New evidence moved the daily-driver copy.',
                personas: [{ slug: 'daily', why: 'Completely new evidence-based why.' }],
                landscape: [],
                pairings: [
                  { job: 'Daily', model: 'Composer', harness: 'Cursor' },
                  { job: 'Design', model: 'Opus', harness: 'Claude Code' },
                  { job: 'Mechanical', model: 'Grok', harness: 'Cursor' },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
    })) as unknown as typeof fetch);

    const res = await syncAgentStacks();
    expect(res.updated).toBe(true);
    expect(stateUpdatedAt().getTime()).toBeGreaterThan(STALE.getTime());
  });
});
