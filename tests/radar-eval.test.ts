import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDb } from './helpers/db';
import { getDb } from '@/lib/db';
import { llmCalls, metricPoints } from '@/lib/db/schema';
import { estimateCostUsd } from '@/lib/llm/pricing';
import {
  EVAL_SUITE,
  EVAL_TARGETS,
  gradeExact,
  gradeRubric,
  gradeRegex,
  runRadarEval,
  stripModelWrappers,
} from '@/lib/science/eval';

/** Known-good answers — each must score exactly 1 against its task's grader. */
const GOOD: Record<string, string> = {
  'coding-python-sum': '30',
  'coding-js-join': '2-4-6',
  'coding-regex-zip': '^\\d{5}$',
  'coding-big-o': 'O(log n)',
  'extract-person': '{"name": "Dr. Elena Vasquez", "age": 42, "company": "Helix Bio", "role": "Chief Scientist"}',
  'extract-invoice': '{"invoice_id": "INV-2049", "total": 1250.00, "currency": "USD", "due_date": "2026-09-15"}',
  'extract-release': '{"product": "PhotonDB", "version": "3.2", "date": "2026-08-01", "channel": "general availability"}',
  'extract-signups': '{"best_day": "Friday", "total": 667, "days": 5}',
  'copy-tagline': 'Cipherpad keeps your notes private — end-to-end encrypted, always.',
  'copy-changelog': 'Version 2.4.0 adds dark mode across the app, with automatic theme switching at sunset.',
  'copy-support-reply':
    "We're sorry your refund is late — it will arrive within 3-5 business days. Thank you for your patience.",
  'copy-launch-post': 'PromptForge is live! Test, compare, and ship better prompts with your whole team. #PromptForge',
};

const ENV_KEYS = ['MINIMAX_API_KEY', 'MINIMAX_BASE_URL', 'GHOST_API_KEY', 'GHOST_BASE_URL'];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  useTestDb();
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.MINIMAX_API_KEY = 'test-key';
  process.env.MINIMAX_BASE_URL = 'https://llm.test/v1';
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function chatResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 120, completion_tokens: 24 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

type FetchHandler = (taskId: string, nthCall: number) => Response;

/** Stubs global fetch; dispatches per task (matched on the exact user prompt), counting calls per task. */
function installFetch(handler: FetchHandler) {
  const counts = new Map<string, number>();
  const mock = vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
    const user = body.messages[body.messages.length - 1]!.content;
    const task = EVAL_SUITE.find((t) => t.user === user);
    if (!task) throw new Error(`fetch called with unknown prompt: ${user.slice(0, 80)}`);
    const nth = counts.get(task.id) ?? 0;
    counts.set(task.id, nth + 1);
    return handler(task.id, nth);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const allGood: FetchHandler = (taskId) => chatResponse(GOOD[taskId]!);

const evalPoints = () =>
  getDb().select().from(metricPoints).where(eq(metricPoints.source, 'radar-eval')).all();

describe('graders', () => {
  it('gradeExact normalizes case, surrounding whitespace, and inner whitespace', () => {
    const g = gradeExact('Hello   World');
    expect(g('  hello world\n')).toBe(1);
    expect(g('HELLO WORLD')).toBe(1);
    expect(g('hello world!')).toBe(0);
    expect(g('')).toBe(0);
  });

  it('gradeRegex is a binary match', () => {
    const g = gradeRegex(/\d{4}-\d{2}-\d{2}/);
    expect(g('released 2026-08-01')).toBe(1);
    expect(g('no date here')).toBe(0);
  });

  it('gradeRubric returns the fraction of weight matched', () => {
    const g = gradeRubric([
      { pattern: /a/, weight: 1 },
      { pattern: /b/, weight: 3 },
    ]);
    expect(g('a')).toBe(0.25);
    expect(g('ab')).toBe(1);
    expect(g('zzz')).toBe(0);
  });
});

describe('stripModelWrappers', () => {
  it('strips a leading think block', () => {
    expect(stripModelWrappers('<think>let me reason…</think>\n42')).toBe('42');
  });

  it('unwraps a leading code fence', () => {
    expect(stripModelWrappers('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it('strips think + fence together', () => {
    expect(stripModelWrappers('<think>hmm</think>\n```\n30\n```')).toBe('30');
  });

  it('treats an unterminated think block as no answer', () => {
    expect(stripModelWrappers('<think>thinking forever')).toBe('');
  });

  it('leaves plain answers untouched', () => {
    expect(stripModelWrappers('  plain answer ')).toBe('plain answer');
  });
});

describe('EVAL_SUITE sanity', () => {
  it('has 12 tasks, 4 per kind, with unique ids', () => {
    expect(EVAL_SUITE).toHaveLength(12);
    for (const kind of ['coding', 'extraction', 'copy'] as const) {
      expect(EVAL_SUITE.filter((t) => t.kind === kind)).toHaveLength(4);
    }
    expect(new Set(EVAL_SUITE.map((t) => t.id)).size).toBe(12);
  });

  it('every grader scores a known-good answer 1 and a bad answer < 1', () => {
    for (const task of EVAL_SUITE) {
      const good = GOOD[task.id];
      expect(good, `missing known-good answer for ${task.id}`).toBeDefined();
      expect(task.grader(good!), `${task.id} should ace the known-good answer`).toBe(1);
      expect(task.grader('utter garbage'), `${task.id} should not ace garbage`).toBeLessThan(1);
    }
  });
});

describe('runRadarEval', () => {
  it('scores MiniMax-M2 and writes score + per-kind sub-scores', async () => {
    installFetch((taskId) => {
      // think block + fence around otherwise-perfect answers must strip cleanly
      if (taskId === 'extract-invoice') {
        return chatResponse(
          `<think>the user wants the invoice fields as JSON.</think>\n\`\`\`json\n${GOOD[taskId]!}\n\`\`\``,
        );
      }
      if (taskId === 'coding-python-sum') return chatResponse(`\`\`\`\n${GOOD[taskId]!}\n\`\`\``);
      return chatResponse(GOOD[taskId]!);
    });

    const stats = await runRadarEval();
    expect(stats).toEqual({ scored: 1, tasks: 12, failed: [] });
    // satisfies withJobRun's Record<string, unknown> constraint
    const rec: Record<string, unknown> = stats;
    expect(Object.keys(rec).sort()).toEqual(['failed', 'scored', 'tasks']);

    const points = evalPoints();
    expect(points).toHaveLength(4);
    const byMetric = new Map(points.map((p) => [p.metric, p]));
    for (const metric of ['score', 'score_coding', 'score_extraction', 'score_copy']) {
      const p = byMetric.get(metric);
      expect(p, `missing metric ${metric}`).toBeDefined();
      expect(p!.entity).toBe('MiniMax-M2');
      expect(p!.value).toBe(100);
    }

    const calls = getDb().select().from(llmCalls).all();
    expect(calls).toHaveLength(12);
    for (const c of calls) {
      expect(c.feature).toBe('eval');
      expect(c.job).toBe('radar-eval');
      expect(c.userId).toBeNull();
      expect(c.model).toBe('MiniMax-M2');
      expect(c.promptTokens).toBe(120);
      expect(c.completionTokens).toBe(24);
      expect(c.durationMs).toBeGreaterThanOrEqual(0);
      expect(c.estCostUsd).toBe(estimateCostUsd('MiniMax-M2', 120, 24));
    }
  });

  it('skips a target whose api key env is unset — no rows, not in failed', async () => {
    EVAL_TARGETS.push({
      entity: 'Ghost-7B',
      modelId: 'ghost/ghost-7b',
      baseUrlEnv: 'GHOST_BASE_URL',
      apiKeyEnv: 'GHOST_API_KEY',
    });
    try {
      installFetch(allGood);
      const stats = await runRadarEval();
      expect(stats.scored).toBe(1); // MiniMax only
      expect(stats.failed).toEqual([]);
      const entities = new Set(evalPoints().map((p) => p.entity));
      expect(entities.has('MiniMax-M2')).toBe(true);
      expect(entities.has('Ghost-7B')).toBe(false);
    } finally {
      EVAL_TARGETS.pop();
    }
  });

  it('retries a flaky task once and still scores it', async () => {
    const fetchMock = installFetch((taskId, nth) =>
      taskId === 'coding-js-join' && nth === 0 ? new Response('boom', { status: 500 }) : chatResponse(GOOD[taskId]!),
    );
    const stats = await runRadarEval();
    expect(stats.failed).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(13); // 12 tasks + 1 retry
    const score = evalPoints().find((p) => p.metric === 'score');
    expect(score!.value).toBe(100);
    // only successful API responses are metered: the 500 attempt wrote nothing
    expect(getDb().select().from(llmCalls).all()).toHaveLength(12);
  });

  it('writes no rows and reports failure when every task fails', async () => {
    const fetchMock = installFetch(() => new Response('boom', { status: 500 }));
    const stats = await runRadarEval();
    expect(stats.scored).toBe(0);
    expect(stats.failed).toHaveLength(1);
    expect(stats.failed[0]).toMatch(/^MiniMax-M2:/);
    expect(evalPoints()).toHaveLength(0);
    expect(getDb().select().from(llmCalls).all()).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(24); // 12 tasks × 2 attempts
  });
});
