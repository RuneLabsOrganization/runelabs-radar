import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useTestDb } from './helpers/db';
import { getDb } from '@/lib/db';
import { jobRuns } from '@/lib/db/schema';
import { withJobRun } from '@/lib/jobs';
import { _setFetch, chatJSON, drainLlmUsageStats } from '@/lib/llm/minimax';

const savedKey = process.env.MINIMAX_API_KEY;

function lastRun() {
  return getDb().select().from(jobRuns).all().at(-1)!;
}

describe('withJobRun — a job whose every LLM call failed is not "ok"', () => {
  beforeEach(() => {
    useTestDb();
    process.env.MINIMAX_API_KEY = 'test-key';
    drainLlmUsageStats();
  });
  afterEach(() => {
    _setFetch(fetch);
    if (savedKey === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = savedKey;
  });

  it('records an error (with the LLM error) when calls > 0 and no tokens came back', async () => {
    // the 2026-10-21 shape: a retired model id → every call 4xx, job swallows it
    _setFetch(async () => new Response('{"error":"unknown model"}', { status: 400 }));
    const res = await withJobRun('brief', async () => {
      try {
        await chatJSON('sys', 'user', { feature: 'brief' });
      } catch {
        /* jobs log and carry on — that is what hid the outage */
      }
      return { wrote: false, ...drainLlmUsageStats() };
    });
    expect(res).toBeNull();
    const run = lastRun();
    expect(run.status).toBe('error');
    expect(run.error).toMatch(/every LLM call failed/);
    expect(run.error).toContain('MiniMax HTTP 400');
    expect(JSON.parse(run.stats!)).toMatchObject({ calls: 1, promptTokens: 0 });
  });

  it('a run refused entirely by the daily LLM cap is an error too, not a silent no-op', async () => {
    const savedCap = process.env.MINIMAX_DAILY_CALL_CAP;
    process.env.MINIMAX_DAILY_CALL_CAP = '1';
    try {
      _setFetch(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"ok":true}' } }],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            }),
          ),
      );
      await withJobRun('brief', async () => {
        await chatJSON('s', 'u'); // spends the day's only call
        return { ...drainLlmUsageStats() };
      });
      expect(lastRun().status).toBe('ok');

      const res = await withJobRun('kit-evidence', async () => {
        await chatJSON('s', 'u').catch(() => null); // refused before any request
        return { attached: 0, ...drainLlmUsageStats() };
      });
      expect(res).toBeNull();
      const run = lastRun();
      expect(run.status).toBe('error');
      expect(run.error).toContain('Daily LLM call cap reached');
    } finally {
      if (savedCap === undefined) delete process.env.MINIMAX_DAILY_CALL_CAP;
      else process.env.MINIMAX_DAILY_CALL_CAP = savedCap;
    }
  });

  it('a job that made no LLM calls stays ok', async () => {
    const res = await withJobRun('brief', async () => ({ wrote: true, ...drainLlmUsageStats() }));
    expect(res).not.toBeNull();
    expect(lastRun().status).toBe('ok');
  });

  it('a job that got tokens back stays ok, even if some calls failed', async () => {
    let n = 0;
    _setFetch(async () =>
      n++ === 0
        ? new Response('{}', { status: 400 })
        : new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"ok":true}' } }],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            }),
          ),
    );
    await withJobRun('brief', async () => {
      await chatJSON('s', 'u').catch(() => null);
      await chatJSON('s', 'u');
      return { ...drainLlmUsageStats() };
    });
    expect(lastRun().status).toBe('ok');
  });
});
