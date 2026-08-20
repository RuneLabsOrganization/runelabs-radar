/**
 * Radar micro-eval (§6c) — a small fixed suite (12 tasks: 4 coding, 4
 * extraction, 4 copy) run weekly against top models. Deterministic graders
 * (exact-match / regex / rubric-lite) score each answer 0..1; per-model means
 * land in metric_points as source 'radar-eval' (metric 'score' on the 0-100
 * scale the §6e Radar Score blends in, plus per-kind sub-scores).
 *
 * PROVIDER-AGNOSTIC TARGETS: EVAL_TARGETS below is the whole config. Each
 * entry names a display `entity` (what metric_points stores — score.ts reads
 * it back as the model entity), the `modelId` sent to the API, and the ENV
 * VAR NAMES holding an OpenAI-compatible base URL and API key. An entry whose
 * apiKey env is unset/empty is SKIPPED (logged, never fatal), so eval breadth
 * is one env var away: uncomment an OpenRouter entry, set OPENROUTER_API_KEY,
 * done. This module reads process.env directly (config.ts is pinned to the
 * default provider and stays untouched).
 *
 * Call path is raw fetch — NOT chatJSON, which is pinned to the configured
 * default model and counts against the pipeline's daily call cap. Metering
 * mirrors chatJSON's Wave-1 instrumentation: one llm_calls row per successful
 * API response (feature 'eval', job 'radar-eval'), best-effort.
 */
import { getDb } from '../db';
import { llmCalls } from '../db/schema';
import { recordMetrics, utcDay } from '../metrics';
import { estimateCostUsd } from '../llm/pricing';

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export interface EvalTarget {
  /** Display name stored as metric_points.entity (score.ts reads it back). */
  entity: string;
  /** Model id sent in the chat/completions request body. */
  modelId: string;
  /** Env var holding the OpenAI-compatible base URL (…/v1). */
  baseUrlEnv: string;
  /** Env var holding the API key; unset/empty → target is skipped. */
  apiKeyEnv: string;
  /** Fallback base URL when baseUrlEnv is unset. */
  defaultBaseUrl?: string;
}

export const EVAL_TARGETS: EvalTarget[] = [
  {
    entity: 'MiniMax-M2',
    modelId: 'MiniMax-M2',
    baseUrlEnv: 'MINIMAX_BASE_URL',
    apiKeyEnv: 'MINIMAX_API_KEY',
    defaultBaseUrl: 'https://api.minimax.io/v1',
  },
  // OpenRouter — one key (OPENROUTER_API_KEY) unlocks most frontier models.
  // Uncomment any of these (or add your own) and the next weekly run scores
  // them alongside MiniMax-M2:
  // {
  //   entity: 'Claude Sonnet 4.5',
  //   modelId: 'anthropic/claude-sonnet-4.5',
  //   baseUrlEnv: 'OPENROUTER_BASE_URL', // default https://openrouter.ai/api/v1
  //   apiKeyEnv: 'OPENROUTER_API_KEY',
  //   defaultBaseUrl: 'https://openrouter.ai/api/v1',
  // },
  // {
  //   entity: 'GPT-5.1',
  //   modelId: 'openai/gpt-5.1',
  //   baseUrlEnv: 'OPENROUTER_BASE_URL',
  //   apiKeyEnv: 'OPENROUTER_API_KEY',
  //   defaultBaseUrl: 'https://openrouter.ai/api/v1',
  // },
  // {
  //   entity: 'Gemini 3 Pro',
  //   modelId: 'google/gemini-3-pro',
  //   baseUrlEnv: 'OPENROUTER_BASE_URL',
  //   apiKeyEnv: 'OPENROUTER_API_KEY',
  //   defaultBaseUrl: 'https://openrouter.ai/api/v1',
  // },
];

// ---------------------------------------------------------------------------
// Graders — deterministic, pure, each returns 0..1
// ---------------------------------------------------------------------------

export type Grader = (output: string) => number;

const normalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** 1 when the normalized output equals the normalized expected string, else 0. */
export function gradeExact(expected: string): Grader {
  const want = normalize(expected);
  return (output) => (normalize(output) === want ? 1 : 0);
}

/** 1 when the output matches the pattern, else 0. */
export function gradeRegex(pattern: RegExp): Grader {
  return (output) => (pattern.test(output) ? 1 : 0);
}

/** Fraction of total check weight whose pattern matched (0..1, partial credit). */
export function gradeRubric(checks: { pattern: RegExp; weight: number }[]): Grader {
  const total = checks.reduce((a, c) => a + c.weight, 0);
  return (output) => {
    if (total <= 0) return 0;
    const got = checks.reduce((a, c) => a + (c.pattern.test(output) ? c.weight : 0), 0);
    return got / total;
  };
}

/** Banned-phrase rubric check: matches (earns weight) only when `phrase` is ABSENT. */
const absent = (phrase: RegExp): RegExp => new RegExp(`^(?![\\s\\S]*${phrase.source})[\\s\\S]*$`, 'i');

/** Length-band rubric check: output length within [min, max] characters. */
const lengthBand = (min: number, max: number): RegExp => new RegExp(`^[\\s\\S]{${min},${max}}$`);

// ---------------------------------------------------------------------------
// Suite — every task has a deterministically gradable answer
// ---------------------------------------------------------------------------

export type EvalKind = 'coding' | 'extraction' | 'copy';

export interface EvalTask {
  id: string;
  kind: EvalKind;
  system: string;
  user: string;
  grader: Grader;
}

const CODING_SYSTEM =
  'You are a precise programming tutor. Answer with ONLY the final answer — no explanation, no code fences, no surrounding text.';

const EXTRACTION_SYSTEM =
  'You are a precise information-extraction engine. Reply with ONLY a single JSON object — no markdown fences, no commentary. Use exactly the field names requested.';

const COPY_SYSTEM =
  'You are a concise product copywriter. Reply with ONLY the requested copy — no preamble, no surrounding quotes, no explanation.';

export const EVAL_SUITE: EvalTask[] = [
  // --- coding: computable answers, not open-ended code ---------------------
  {
    id: 'coding-python-sum',
    kind: 'coding',
    system: CODING_SYSTEM,
    user: 'What does this Python snippet print?\n\nprint(sum([x * x for x in range(5)]))\n\nReply with only the printed output.',
    grader: gradeExact('30'),
  },
  {
    id: 'coding-js-join',
    kind: 'coding',
    system: CODING_SYSTEM,
    user: "What does this JavaScript expression evaluate to?\n\n[1, 2, 3].map((x) => x * 2).join('-')\n\nReply with only the resulting string.",
    grader: gradeExact('2-4-6'),
  },
  {
    id: 'coding-regex-zip',
    kind: 'coding',
    system: CODING_SYSTEM,
    user: 'Write a JavaScript regular expression that matches a 5-digit US ZIP code. Reply with only the regex pattern — no slashes, no flags, no explanation.',
    grader: gradeRegex(/(\\d|\[0-9\])\{5\}/),
  },
  {
    id: 'coding-big-o',
    kind: 'coding',
    system: CODING_SYSTEM,
    user: 'What is the worst-case time complexity of binary search on a sorted array of n elements? Reply with only the Big-O notation, e.g. O(n).',
    grader: gradeExact('O(log n)'),
  },
  // --- extraction: JSON with exact-match fields from a given text ----------
  {
    id: 'extract-person',
    kind: 'extraction',
    system: EXTRACTION_SYSTEM,
    user: 'Extract JSON with fields "name" (string), "age" (number), "company" (string), "role" (string) from this text:\n\nDr. Elena Vasquez, 42, joined Helix Bio as Chief Scientist.',
    grader: gradeRubric([
      { pattern: /"name"\s*:\s*"[^"]*Elena Vasquez[^"]*"/i, weight: 1 },
      { pattern: /"age"\s*:\s*42/, weight: 1 },
      { pattern: /"company"\s*:\s*"[^"]*Helix Bio[^"]*"/i, weight: 1 },
      { pattern: /"role"\s*:\s*"[^"]*Chief Scientist[^"]*"/i, weight: 1 },
    ]),
  },
  {
    id: 'extract-invoice',
    kind: 'extraction',
    system: EXTRACTION_SYSTEM,
    user: 'Extract JSON with fields "invoice_id" (string), "total" (number), "currency" (string), "due_date" (string) from this text:\n\nInvoice INV-2049 from Northwind Traders totals $1,250.00 USD, due 2026-09-15.',
    grader: gradeRubric([
      { pattern: /"invoice_id"\s*:\s*"INV-2049"/i, weight: 1 },
      { pattern: /"total"\s*:\s*1250(?:\.0+)?/, weight: 1 },
      { pattern: /"currency"\s*:\s*"USD"/i, weight: 1 },
      { pattern: /"due_date"\s*:\s*"2026-09-15"/, weight: 1 },
    ]),
  },
  {
    id: 'extract-release',
    kind: 'extraction',
    system: EXTRACTION_SYSTEM,
    user: 'Extract JSON with fields "product" (string), "version" (string), "date" (string), "channel" (string) from this text:\n\nAcme shipped PhotonDB 3.2 to general availability on 2026-08-01.',
    grader: gradeRubric([
      { pattern: /"product"\s*:\s*"[^"]*PhotonDB[^"]*"/i, weight: 1 },
      { pattern: /"version"\s*:\s*"?3\.2"?/, weight: 1 },
      { pattern: /"date"\s*:\s*"2026-08-01"/, weight: 1 },
      { pattern: /"channel"\s*:\s*"[^"]*general availability[^"]*"/i, weight: 1 },
    ]),
  },
  {
    id: 'extract-signups',
    kind: 'extraction',
    system: EXTRACTION_SYSTEM,
    user: 'Extract JSON with fields "best_day" (string), "total" (number, sum of all days), "days" (number) from this text:\n\nDaily signups last week: Mon 120, Tue 98, Wed 143, Thu 131, Fri 175.',
    grader: gradeRubric([
      { pattern: /"best_day"\s*:\s*"fri(?:day)?"/i, weight: 1 },
      { pattern: /"total"\s*:\s*667/, weight: 1 },
      { pattern: /"days"\s*:\s*5/, weight: 1 },
    ]),
  },
  // --- copy: required elements + banned phrases + length band --------------
  {
    id: 'copy-tagline',
    kind: 'copy',
    system: COPY_SYSTEM,
    user: "Write a single-line tagline (20-90 characters) for Cipherpad, a privacy-first notes app. It must mention privacy (use the word 'private' or 'privacy'). Do not use the words 'revolutionary' or 'best'.",
    grader: gradeRubric([
      { pattern: /priva(?:te|cy)/i, weight: 2 },
      { pattern: absent(/revolutionary/), weight: 1 },
      { pattern: absent(/\bbest\b/), weight: 1 },
      { pattern: lengthBand(20, 90), weight: 1 },
    ]),
  },
  {
    id: 'copy-changelog',
    kind: 'copy',
    system: COPY_SYSTEM,
    user: "Write a changelog entry (40-160 characters, one or two sentences) for version 2.4.0 of our app, adding dark mode. It must include the version number '2.4.0'. Do not use the word 'excited'.",
    grader: gradeRubric([
      { pattern: /2\.4\.0/, weight: 2 },
      { pattern: /dark mode/i, weight: 2 },
      { pattern: absent(/excited/), weight: 1 },
      { pattern: lengthBand(40, 160), weight: 1 },
    ]),
  },
  {
    id: 'copy-support-reply',
    kind: 'copy',
    system: COPY_SYSTEM,
    user: "Write a short support reply (60-200 characters) to a customer whose refund is delayed. It must apologize (use 'sorry' or 'apologize') and state the refund will arrive within 3-5 business days. Do not use the phrase 'calm down'.",
    grader: gradeRubric([
      { pattern: /sorry|apolog/i, weight: 2 },
      { pattern: /3\s*[-–]\s*5 business days/i, weight: 2 },
      { pattern: absent(/calm down/), weight: 1 },
      { pattern: lengthBand(60, 200), weight: 1 },
    ]),
  },
  {
    id: 'copy-launch-post',
    kind: 'copy',
    system: COPY_SYSTEM,
    user: "Write a launch post for social media (50-240 characters) announcing PromptForge, a prompt-testing workbench. It must include the hashtag #PromptForge. Do not use the words 'game-changer' or 'game changer'.",
    grader: gradeRubric([
      { pattern: /#promptforge\b/i, weight: 2 },
      { pattern: absent(/game[ -]?changer/), weight: 1 },
      { pattern: lengthBand(50, 240), weight: 1 },
    ]),
  },
];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Type alias (not interface) so it satisfies withJobRun's Record<string, unknown> constraint. */
export type RadarEvalStats = { scored: number; tasks: number; failed: string[] };

const FETCH_TIMEOUT_MS = 120_000;

/**
 * Strips model wrappers before grading: a leading <think>…</think> block
 * (MiniMax-M2 emits these) and/or a leading ``` fence. An unterminated think
 * block means the model spent its whole token budget thinking — no answer
 * followed, so the gradable answer is empty.
 */
export function stripModelWrappers(raw: string): string {
  let s = raw.trim();
  if (/^<think>/i.test(s)) {
    const close = s.search(/<\/think>/i);
    if (close === -1) return '';
    s = s.slice(close + '</think>'.length).trim();
  }
  const fence = s.match(/^```[^\n`]*\n?([\s\S]*?)```/);
  if (fence) s = fence[1]!.trim();
  return s;
}

interface ResolvedTarget extends EvalTarget {
  apiKey: string;
  baseUrl: string;
}

interface CallResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

class EvalHttpError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

/** One OpenAI-compatible chat/completions call against the target provider. */
async function callChat(target: ResolvedTarget, task: EvalTask): Promise<CallResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${target.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${target.apiKey}`,
      },
      body: JSON.stringify({
        model: target.modelId,
        temperature: 0,
        // MiniMax-M2 spends thinking tokens (<think>) from this same budget —
        // 4000 leaves room for the reasoning plus the actual answer.
        max_tokens: 4000,
        messages: [
          { role: 'system', content: task.system },
          { role: 'user', content: task.user },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const durationMs = Date.now() - startedAt;
  if (!res.ok) {
    throw new EvalHttpError(`HTTP ${res.status}`, res.status >= 500);
  }
  let data: {
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new EvalHttpError('malformed JSON body', true);
  }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new EvalHttpError('missing choices[0].message.content', true);
  }
  return {
    content,
    promptTokens: Number(data.usage?.prompt_tokens) || 0,
    completionTokens: Number(data.usage?.completion_tokens) || 0,
    durationMs,
  };
}

/**
 * Meter one successful API response (feature 'eval', job 'radar-eval') so
 * /admin/usage stays honest. Best-effort: metering must never break a run.
 */
function meterCall(target: ResolvedTarget, r: CallResult): void {
  try {
    getDb()
      .insert(llmCalls)
      .values({
        ts: new Date(),
        feature: 'eval',
        job: 'radar-eval',
        userId: null,
        model: target.modelId,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        durationMs: r.durationMs,
        estCostUsd: estimateCostUsd(target.modelId, r.promptTokens, r.completionTokens),
      })
      .run();
  } catch (e) {
    console.error('[radar-eval] metering insert failed:', e);
  }
}

/** Runs one task; ONE retry on network/5xx/malformed-JSON, then the task scores 0. */
async function runTask(
  target: ResolvedTarget,
  task: EvalTask,
): Promise<{ ok: boolean; score: number; error?: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await callChat(target, task);
      meterCall(target, r);
      const answer = stripModelWrappers(r.content);
      const score = Math.min(1, Math.max(0, task.grader(answer)));
      return { ok: true, score };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = !(e instanceof EvalHttpError) || e.retryable;
      if (!retryable || attempt === 1) return { ok: false, score: 0, error: msg };
      console.warn(`[radar-eval] ${target.entity} ${task.id}: ${msg} — retrying once`);
    }
  }
  return { ok: false, score: 0, error: 'unreachable' };
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** 0..1 mean → 0-100, rounded to 2dp. */
const pct = (v: number): number => Math.round(v * 10000) / 100;

/**
 * Weekly micro-eval: scores every configured target on EVAL_SUITE and writes
 * metric_points rows (source 'radar-eval', entity = display name, metric
 * 'score' | 'score_coding' | 'score_extraction' | 'score_copy'). Targets with
 * no API key are skipped; per-task failures score 0 after one retry; a model
 * whose every task fails gets no rows that week (logged, in stats.failed).
 */
export async function runRadarEval(): Promise<RadarEvalStats> {
  const stats: RadarEvalStats = { scored: 0, tasks: EVAL_SUITE.length, failed: [] };
  const date = utcDay();
  for (const target of EVAL_TARGETS) {
    const apiKey = (process.env[target.apiKeyEnv] ?? '').trim();
    if (!apiKey) {
      console.warn(`[radar-eval] skipping ${target.entity}: ${target.apiKeyEnv} is not set`);
      continue;
    }
    const baseUrl = (
      (process.env[target.baseUrlEnv] ?? '').trim() ||
      target.defaultBaseUrl ||
      ''
    ).replace(/\/+$/, '');
    if (!baseUrl) {
      console.error(`[radar-eval] ${target.entity}: ${target.baseUrlEnv} is not set and has no default — skipping`);
      stats.failed.push(`${target.entity}:${target.baseUrlEnv} is not set`);
      continue;
    }
    const resolved: ResolvedTarget = { ...target, apiKey, baseUrl };

    const results: { kind: EvalKind; score: number }[] = [];
    let succeeded = 0;
    for (const task of EVAL_SUITE) {
      const r = await runTask(resolved, task);
      if (r.ok) {
        succeeded++;
      } else {
        console.error(`[radar-eval] ${target.entity} ${task.id}: scored 0 after retry (${r.error})`);
      }
      results.push({ kind: task.kind, score: r.score });
    }

    if (succeeded === 0) {
      console.error(`[radar-eval] ${target.entity}: all ${EVAL_SUITE.length} tasks failed — no metrics written this week`);
      stats.failed.push(`${target.entity}:all ${EVAL_SUITE.length} tasks failed`);
      continue;
    }

    const points = [
      {
        source: 'radar-eval',
        entity: target.entity,
        metric: 'score',
        value: pct(mean(results.map((r) => r.score))),
        date,
      },
      ...(['coding', 'extraction', 'copy'] as const).map((kind) => ({
        source: 'radar-eval',
        entity: target.entity,
        metric: `score_${kind}`,
        value: pct(mean(results.filter((r) => r.kind === kind).map((r) => r.score))),
        date,
      })),
    ];
    recordMetrics(points);
    stats.scored++;
    console.log(
      `[radar-eval] ${target.entity}: score=${points[0]!.value} (${succeeded}/${EVAL_SUITE.length} tasks ok)`,
    );
  }
  return stats;
}
