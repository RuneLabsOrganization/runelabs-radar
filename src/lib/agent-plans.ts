/**
 * Coding-agent subscription tracker (master plan Phase 10).
 *
 * The question our audience keeps asking: "which agent plan is worth it."
 * This module is the answer's data half — a hand-maintained table of the
 * coding-agent subscription landscape (list price + headline limits + a
 * one-line editorial verdict) plus a weekly sync that logs each price into
 * metric_points as a first-party series:
 *   source 'agent-plans' · entity '<Vendor> <Plan>' · metric 'price_usd_mo'
 *
 * The public /agent-plans page renders the const directly (always current,
 * no DB dependency); the metric series exist so price *changes* accumulate
 * into a chartable history. Registration (weekly cron in worker/) is done
 * by the integrator, not here.
 */

// last manual review: 2026-08 — review quarterly; this is manual-seeded editorial data

import { recordMetrics, type MetricInput } from './metrics';

export interface AgentPlan {
  /** Vendor-public name — the entity key's first half. */
  vendor: string;
  /** Plan name as the vendor advertises it. */
  name: string;
  /** List price, USD per month (0 = free tier). Annual-commit headline where that's the advertised rate. */
  priceUsdMo: number;
  /** Key usage limits — requests/messages/credits, one short string. */
  limits: string;
  /** One-line editorial verdict. */
  verdict: string;
}

/**
 * The landscape as of 2026-08. Keep it to the plans builders actually ask
 * about — one row per plan tier, entity key = '<Vendor> <Plan>' (see
 * planEntity). Prices are list prices; "unlimited" always means
 * vendor-throttled in practice, so the limits column carries the number
 * that actually bites.
 */
export const AGENT_PLANS: AgentPlan[] = [
  // ── the IDE agents ──
  {
    vendor: 'Cursor',
    name: 'Hobby',
    priceUsdMo: 0,
    limits: '2,000 completions + 50 slow premium requests/mo',
    verdict: 'The demo tier — fine for a weekend, not a workflow.',
  },
  {
    vendor: 'Cursor',
    name: 'Pro',
    priceUsdMo: 20,
    limits: '~500 fast premium requests/mo + unlimited slow pool · Tab',
    verdict: 'The default daily-driver IDE agent — Tab alone pays for it.',
  },
  {
    vendor: 'Cursor',
    name: 'Ultra',
    priceUsdMo: 200,
    limits: '~20× Pro agent usage',
    verdict: 'Only if multi-hour agent sessions are your normal day.',
  },
  {
    vendor: 'Windsurf',
    name: 'Pro',
    priceUsdMo: 15,
    limits: '500 prompt credits/mo',
    verdict: 'Cheapest agentic IDE seat; Cascade drains credits fast.',
  },
  // ── the CLI / terminal agents ──
  {
    vendor: 'Anthropic',
    name: 'Claude Code Pro',
    priceUsdMo: 20,
    limits: '~45 messages per 5h window (shared with claude.ai)',
    verdict: 'Cheapest seat on the strongest CLI agent; limits bite on long refactors.',
  },
  {
    vendor: 'Anthropic',
    name: 'Claude Code Max 20×',
    priceUsdMo: 200,
    limits: '~20× Pro limits · Opus access',
    verdict: 'The power-user ceiling — worth it when Claude Code is your primary builder.',
  },
  {
    vendor: 'OpenAI',
    name: 'ChatGPT Plus (Codex)',
    priceUsdMo: 20,
    limits: 'Codex CLI + cloud tasks, session-capped',
    verdict: 'Best value if you already pay for ChatGPT — Codex rides along.',
  },
  {
    vendor: 'OpenAI',
    name: 'ChatGPT Pro (Codex)',
    priceUsdMo: 200,
    limits: '~unlimited Codex · max reasoning tiers',
    verdict: 'Frontier-max Codex; only for teams billing by the week, not the month.',
  },
  {
    vendor: 'Moonshot',
    name: 'Kimi Code',
    priceUsdMo: 0,
    limits: 'free daily quota · membership tiers for higher limits',
    verdict: 'K2-class CLI coding at zero dollars — the open-weights-friendly pick.',
  },
  // ── the platform add-ons ──
  {
    vendor: 'GitHub',
    name: 'Copilot Pro',
    priceUsdMo: 10,
    limits: 'unlimited completions · 300 premium requests/mo',
    verdict: "The budget default — competent agent mode at half everyone else's price.",
  },
  {
    vendor: 'GitHub',
    name: 'Copilot Pro+',
    priceUsdMo: 39,
    limits: '1,500 premium requests/mo · all models',
    verdict: 'The sensible middle: every frontier model, no $200 commitment.',
  },
  {
    vendor: 'Google',
    name: 'Gemini Code Assist',
    priceUsdMo: 0,
    limits: '~180k completions/mo free for individuals',
    verdict: 'Absurdly generous free tier; the agent story is still maturing.',
  },
];

/** '<Vendor> <Plan>' — the metric_points entity key. */
export function planEntity(p: AgentPlan): string {
  return `${p.vendor} ${p.name}`;
}

/** Flattens the table into metric points. Exported for tests. */
export function planPoints(plans: AgentPlan[] = AGENT_PLANS): MetricInput[] {
  return plans.map((p) => ({
    source: 'agent-plans',
    entity: planEntity(p),
    metric: 'price_usd_mo',
    value: p.priceUsdMo,
  }));
}

/**
 * Weekly sync. Idempotent per day — recordMetrics upserts on
 * (source, entity, metric, date), so a re-run updates today's rows in place
 * and the series grows one point per day at most.
 */
export async function syncAgentPlans(): Promise<{ recorded: number }> {
  return { recorded: recordMetrics(planPoints()) };
}
