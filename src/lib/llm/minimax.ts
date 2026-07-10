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

/**
 * One curation call to MiniMax (OpenAI-compatible chat completions).
 * Counts against the daily cap once per invocation; 3 attempts with backoff
 * on retryable failures (429/5xx/network/malformed JSON).
 */
export async function chatJSON<T>(system: string, user: string): Promise<T> {
  if (!config.minimaxApiKey) {
    throw new LlmError('MINIMAX_API_KEY not set', false);
  }
  checkAndCountCall();
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
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
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
