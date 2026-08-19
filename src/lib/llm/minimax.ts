import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { llmUsage } from '../db/schema';
import { config } from '../config';

export class LlmError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'LlmError';
    this.retryable = retryable;
  }
}

let _fetch: typeof fetch = fetch;
/** Test hook: replace fetch. */
export function _setFetch(f: typeof fetch): void {
  _fetch = f;
}

// token usage accumulator for the current job run — drained into the job's
// stats JSON so the admin panel sees cost, not just call counts
let _calls = 0;
let _promptTokens = 0;
let _completionTokens = 0;

/** Returns accumulated usage since the last drain and resets the counters. */
export function drainLlmUsageStats(): { calls: number; promptTokens: number; completionTokens: number } {
  const out = { calls: _calls, promptTokens: _promptTokens, completionTokens: _completionTokens };
  _calls = 0;
  _promptTokens = 0;
  _completionTokens = 0;
  return out;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Increments the daily counter; throws (non-retryable) when the cap is hit. */
function checkAndCountCall(): void {
  const db = getDb();
  const date = today();
  db.insert(llmUsage).values({ date, calls: 0 }).onConflictDoNothing().run();
  const row = db.select().from(llmUsage).where(eq(llmUsage.date, date)).get();
  const calls = row?.calls ?? 0;
  if (calls >= config.minimaxDailyCallCap) {
    throw new LlmError(`Daily LLM call cap reached (${config.minimaxDailyCallCap})`, false);
  }
  db.update(llmUsage).set({ calls: calls + 1 }).where(eq(llmUsage.date, date)).run();
}

function extractJson(content: string): string {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new LlmError('No JSON object in LLM response', true);
  }
  return content.slice(start, end + 1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Per-job daily budgets (worker-process-local): keep one hungry job from
// starving the rest against the shared daily cap. Curate is the only
// high-volume job; the others are bounded by their fixed schedules.
const JOB_DAILY_CAPS: Record<string, number> = { curate: config.minimaxCurateDailyCap };
const jobCallsToday = new Map<string, { date: string; calls: number }>();

/** Throws (non-retryable) when the job's daily budget is spent. */
function checkJobBudget(job: string): void {
  const cap = JOB_DAILY_CAPS[job];
  if (cap === undefined) return;
  const date = today();
  const rec = jobCallsToday.get(job);
  const calls = rec?.date === date ? rec.calls : 0;
  if (calls >= cap) {
    throw new LlmError(`Daily LLM call cap for job "${job}" reached (${cap})`, false);
  }
  jobCallsToday.set(job, { date, calls: calls + 1 });
}

/**
 * One curation call to MiniMax (OpenAI-compatible chat completions).
 * Counts against the daily cap once per invocation; 3 attempts with backoff
 * on retryable failures (429/5xx/network/malformed JSON). opts.job enforces
 * the per-job daily budget (worker jobs only). opts.maxTokens overrides the
 * 6000 default (MiniMax-M2 spends thinking tokens from the same budget —
 * long structured jobs like plan phases need headroom).
 */
export async function chatJSON<T>(system: string, user: string, opts?: { job?: string; maxTokens?: number }): Promise<T> {
  if (!config.minimaxApiKey) {
    throw new LlmError('MINIMAX_API_KEY not set', false);
  }
  if (opts?.job) checkJobBudget(opts.job);
  checkAndCountCall();
  _calls++;
  const backoffs = [1000, 4000];
  for (let attempt = 0; ; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      let res: Response;
      try {
        res = await _fetch(`${config.minimaxBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.minimaxApiKey}`,
          },
          body: JSON.stringify({
            model: config.minimaxModel,
            temperature: 0.2,
            // bound runaway output WITHOUT clipping the long jobs: MiniMax-M2
            // spends thinking tokens (<think>) from this same budget — 800
            // truncated the brief mid-think; 6000 fits thinking + a full brief
            max_tokens: opts?.maxTokens ?? 6000,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        throw new LlmError(`MiniMax HTTP ${res.status}`, res.status === 429 || res.status >= 500);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      _promptTokens += Number(data.usage?.prompt_tokens) || 0;
      _completionTokens += Number(data.usage?.completion_tokens) || 0;
      const content = data.choices?.[0]?.message?.content ?? '';
      return JSON.parse(extractJson(content)) as T;
    } catch (e) {
      const err =
        e instanceof LlmError ? e : new LlmError(e instanceof Error ? e.message : String(e), true);
      if (!err.retryable || attempt >= 2) throw err;
      await sleep(backoffs[attempt]);
    }
  }
}
