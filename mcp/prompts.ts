import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DOMAINS } from '../src/lib/domains';
import { getIdentity } from '../src/lib/identity';

/**
 * Guided workflow prompts — the "skills" an agent can invoke. Each returns a
 * single user message that walks the agent through the right tool calls in
 * the right order, with the judgment rules baked in.
 */

function userMessage(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'find_and_plan',
    {
      description:
        'The flagship: scan current opportunities, pick the strongest one for you, and generate a granular execution plan you can run on this machine.',
      argsSchema: {
        sector: z.string().optional().describe('restrict to a sector, e.g. devtools, ai-coding'),
        domain: z.enum(DOMAINS).optional().describe('restrict to a domain lens'),
      },
    },
    ({ sector, domain }) =>
      userMessage(`Let's find something worth building from ${getIdentity().productName} and turn it into an executable plan.

1. Call get_opportunities${sector ? ` with sector="${sector}"` : ''} (limit 10). Rank candidates by flip_score for a fast build-and-sell play, hold_score for a keep-and-grow play. Skip verdict="reject".
2. For the top 2-3 candidates, call get_opportunity (by slug) and compare: sub_scores (demand, buildability, competition), kpis (monthly cost, break-even customers), the critic's killRisks, and the launch brief.
3. Present the comparison to me in a short table and recommend ONE, with the reasons. Wait for my confirmation.
4. Call generate_plan for the confirmed opportunity. This returns a full-lifecycle task graph (validation → build → launch → gtm → revenue) plus markdown.
5. Save the markdown as PLAN.md in the current project directory. Then execute the tasks in dependency order, starting with the validation phase: for each task, do the work, check every acceptance criterion, run the verify step, and only then move on. Track progress in PLAN.md by checking off completed tasks.
${domain ? `\nNote: I'm especially interested in the ${domain} angle — weigh that when comparing candidates.` : ''}`),
  );

  server.registerPrompt(
    'whats_new_today',
    { description: 'A catch-up digest: prefer ask_radar synthesis, or the daily brief — do not fetch four tools.', argsSchema: {} },
    () =>
      userMessage(`Give me a sharp "what happened in AI" digest.

Prefer ONE call: ask_radar with question "What mattered in AI for builders in the last 48 hours?" — Radar synthesizes server-side.

Fallback if ask_radar is unavailable or quota-blocked:
1. Call get_daily_brief once.
2. Optionally get_patterns (days 2) for anomalies only if the brief is thin.

Synthesize into one briefing: 3-5 things that matter (with why), and one sentence on what to watch tomorrow. Do NOT call get_top_signals + get_launches + get_patterns + get_daily_brief together.`),
  );

  server.registerPrompt(
    'what_should_i_use',
    {
      description: 'Cost-benefit answer for "what model/tool should I use for X" — board picks backed by live market prices.',
      argsSchema: {
        task: z.string().describe('what you need to do, e.g. "summarize support tickets", "generate product photos"'),
        domain: z.enum(DOMAINS).optional().describe('domain if obvious; the model can infer otherwise'),
      },
    },
    ({ task, domain }) =>
      userMessage(`I need to pick a model/tool for this task: "${task}".
If this is about which coding IDE, agent harness, or vibe-coding stack to run (Cursor vs Claude Code vs Codex vs Copilot), call list_agent_stacks then get_agent_stack_for for the persona that matches me, and stop there.
Otherwise call decide once${domain ? ` with domain="${domain}"` : ''} — it returns board + market in one shot. Do NOT separately call get_best_right_now and get_market_models.
Give me a recommendation in three tiers (best overall / best value / cheapest viable) from the decide result.`),
  );

  server.registerPrompt(
    'which_agent_stack',
    {
      description:
        'Which coding IDE + harness + model to run (Cursor vs Claude Code vs Codex vs Copilot), by persona and real monthly spend.',
      argsSchema: {
        who: z
          .string()
          .optional()
          .describe('who you are, e.g. indie founder, daily IDE user, budget, power user, non-coder, enterprise'),
      },
    },
    ({ who }) =>
      userMessage(`Help me pick a coding-agent stack (IDE + harness + model), not a product tech stack.
1. Call list_agent_stacks. Read personas, landscape (loved % vs this week's mention heat), and model pairings.
2. ${who ? `Call get_agent_stack_for with persona matching "${who}".` : 'Ask me which persona I am (indie, daily, budget, power, nocoder, enterprise), then call get_agent_stack_for for that slug.'}
3. Recommend one stack with typical monthly cost, what to skip, and which model to run in which harness. Cite loved % when it exists.
4. If I only asked about seat prices, send me to the hub /agent-plans page rather than inventing list prices.
Do not confuse this with list_stacks / get_stack_for — those are venture product playbooks (Next.js, Supabase, etc.).`),
  );

  server.registerPrompt(
    'validate_idea',
    {
      description: 'Pressure-test a product idea against observed pains, launches, comps, and detected opportunities.',
      argsSchema: { idea: z.string().describe('the idea in one or two sentences') },
    },
    ({ idea }) =>
      userMessage(`Pressure-test this idea: "${idea}"
1. Call the debate_idea tool with idea="${idea}". It runs a multi-role debate (advocate → skeptic → market realist → judge) grounded in the platform's live intelligence — observed pains, money comps, launch activity, the model market, and the closest detected opportunities.
2. Present the result: the verdict (pursue / watch / reject) and confidence, the kill risks (the concrete ways this dies), and the conditions to succeed.
3. Show me the 2-3 strengthened variants the judge proposed and recommend the strongest one, with the reasons.
4. If it surfaced a closest existing opportunity that already has a plan, mention it.
Be honest — I'd rather hear "reject" now than fail in month two. If the verdict is watch or reject, offer to run scout_opportunities to find a stronger opening fitted to my constraints.`),
  );

  server.registerPrompt(
    'builder_weekly_review',
    { description: 'Weekly review for builders: board changes, forecast grades, accuracy, and the freshest opportunities.', argsSchema: {} },
    () =>
      userMessage(`Run my weekly builder review:
1. Call get_board_changes (days 7) — which picks changed, and does any change affect my current stack?
2. Call get_forecasts and get_accuracy — how calibrated is the platform right now; how much should I trust this week's signals?
3. Call get_opportunities (limit 5) — the newest strongest openings since last week.
4. Call get_market_models (sort "value", limit 5) — the current best intelligence-per-dollar.
Summarize as: what changed, what's now true that wasn't last week, what I should reconsider, and one concrete action for this week.`),
  );
}
