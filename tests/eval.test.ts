import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { llmCalls, metricPoints } from '@/lib/db/schema';
import { runRadarEval } from '@/lib/science/eval';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

let db: Db;

const savedEnv = { key: process.env.MINIMAX_API_KEY, base: process.env.MINIMAX_BASE_URL };

beforeEach(() => {
  db = useTestDb();
  process.env.MINIMAX_API_KEY = 'test-key';
  delete process.env.MINIMAX_BASE_URL; // the target's default base URL applies; fetch is stubbed
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (savedEnv.key === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = savedEnv.key;
  if (savedEnv.base === undefined) delete process.env.MINIMAX_BASE_URL;
  else process.env.MINIMAX_BASE_URL = savedEnv.base;
});

const CORRECT: [needle: string, answer: string][] = [
  ['ZIP code', '\\d{5}'],
  ['binary search', 'O(log n)'],
  ['Dr. Elena Vasquez', '{"name":"Dr. Elena Vasquez","age":42,"company":"Helix Bio","role":"Chief Scientist"}'],
  ['INV-2049', '{"invoice_id":"INV-2049","total":1250.00,"currency":"USD","due_date":"2026-09-15"}'],
  ['PhotonDB 3.2', '{"product":"PhotonDB","version":"3.2","date":"2026-08-01","channel":"general availability"}'],
  ['Daily signups', '{"best_day":"Friday","total":667,"days":5}'],
  ['Cipherpad', 'Private notes that stay yours alone.'],
  ['version 2.4.0', 'Version 2.4.0 adds dark mode across the whole app.'],
  ['refund is delayed', "We're sorry — your refund will arrive within 3-5 business days. Thank you for bearing with us."],
  ['PromptForge', 'Shipped: PromptForge, a workbench for testing prompts before they bite. #PromptForge'],
];

/**
 * One provider answering the suite: coding-python-sum gets a genuinely WRONG
 * answer (a real 0), coding-js-join fails on HTTP 500s (infrastructure), the
 * other ten tasks answer correctly.
 */
function stubProvider(): void {
  vi.stubGlobal('fetch', async (_input: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}') as { messages: { content: string }[] };
    const user = body.messages[1]?.content ?? '';
    if (user.includes('print(sum(')) return chat('99'); // wrong on purpose → real 0
    if (user.includes(".map((x) => x * 2).join")) return new Response('boom', { status: 500 });
    const hit = CORRECT.find(([needle]) => user.includes(needle));
    if (!hit) throw new Error(`unexpected eval prompt in test: ${user.slice(0, 80)}`);
    return chat(hit[1]);
  });
}

function chat(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function evalPoints(): Map<string, number> {
  const rows = db.select().from(metricPoints).where(eq(metricPoints.source, 'radar-eval')).all();
  return new Map(rows.map((r) => [r.metric, r.value]));
}

describe('runRadarEval', () => {
  it('excludes infrastructure failures from the capability average but keeps genuine zeros', async () => {
    stubProvider();

    const stats = await runRadarEval();

    expect(stats).toEqual({ scored: 1, tasks: 12, failed: [] });
    const points = evalPoints();
    // 10 correct + 1 genuine 0 over 11 answered tasks — the 500ing task is NOT averaged in
    expect(points.get('score')).toBe(90.91);
    // coding: wrong-sum 0 + regex 1 + big-o 1 over the 3 answered coding tasks
    expect(points.get('score_coding')).toBe(66.67);
    expect(points.get('score_extraction')).toBe(100);
    expect(points.get('score_copy')).toBe(100);

    // metering: one llm_calls row per successful API response — the failed task meters nothing
    expect(db.select().from(llmCalls).all()).toHaveLength(11);
  });

  it('writes no metrics when every task fails on infrastructure', async () => {
    vi.stubGlobal('fetch', async () => new Response('boom', { status: 500 }));

    const stats = await runRadarEval();

    expect(stats.scored).toBe(0);
    expect(stats.failed).toHaveLength(1);
    expect(evalPoints().size).toBe(0);
    expect(db.select().from(llmCalls).all()).toHaveLength(0);
  });
});
