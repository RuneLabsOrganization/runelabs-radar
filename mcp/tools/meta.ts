import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { count, eq, gte } from 'drizzle-orm';
import { getDb } from '../../src/lib/db';
import { launches, opportunities, stacks, stories } from '../../src/lib/db/schema';
import { getIdentity } from '../../src/lib/identity';
import { config } from '../../src/lib/config';
import { text } from '../lib/payload';
import type { AuthContext } from '../lib/auth';

/**
 * Orientation for a freshly-connected agent: what this server knows, how the
 * tools group, and the workflows the prompts implement. Markdown on purpose —
 * this one is for the model to read, not to parse.
 */
export function registerMetaTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'get_server_guide',
    {
      description:
        'What this server offers and how to use it: tool groups, the opportunity→plan flagship workflow, and current data coverage. Call this first if you are unsure which tool to use.',
      inputSchema: {},
    },
    async () => {
      const id = getIdentity();
      const db = getDb();
      const stats = {
        curated_stories: db.select({ c: count() }).from(stories).where(eq(stories.status, 'curated')).get()?.c ?? 0,
        active_opportunities:
          db.select({ c: count() }).from(opportunities).where(eq(opportunities.status, 'active')).get()?.c ?? 0,
        stack_playbooks: db.select({ c: count() }).from(stacks).get()?.c ?? 0,
        launches_7d:
          db
            .select({ c: count() })
            .from(launches)
            .where(gte(launches.launchedAt, new Date(Date.now() - 7 * 864e5)))
            .get()?.c ?? 0,
      };
      return text(`# ${id.productName} — MCP server guide

${id.brandContext}

## What this server knows (live counts)
- ${stats.curated_stories} curated stories, scored per domain (coding, copy, image, video, ads, agentic)
- ${stats.active_opportunities} active monetizable opportunities, adversarially reviewed
- ${stats.stack_playbooks} venture stack playbooks
- ${stats.launches_7d} product launches in the last 7 days
- plus: pain points, anomaly patterns, topic map, model-market prices, metric series, forecasts, accuracy track record, entity profiles, money comps

## Tool groups
- **News**: get_daily_brief, get_domain_digest, get_daily_insights, get_top_signals, search_stories, get_story
- **Decisions**: get_best_right_now, get_board_changes, get_market_models, list_stacks, get_stack_for
- **Ideas**: get_opportunities, get_opportunity, get_pain_points, get_comps, get_launches, get_patterns, get_topic_map
- **Execution**: generate_plan, get_plan — the flagship (see below)
- **Data**: list_metrics, get_metric_series, get_forecasts, get_accuracy, get_entity
- **Meta**: get_server_guide (this)

## The flagship workflow: opportunity → plan
1. get_opportunities → pick one (flip_score ranks fast flips, hold_score ranks keepers)
2. get_opportunity → the full dossier (scores, KPIs, evidence, critic review, brief)
3. generate_plan → a full-lifecycle execution plan (validation → build → launch → GTM → revenue) as a task graph: dependencies, files to touch, acceptance criteria, verification steps, time estimates
4. Save the plan locally and execute it task by task, checking each acceptance criterion

There is also a guided prompt for this: **find_and_plan**. Other prompts: whats_new_today, what_should_i_use, validate_idea, builder_weekly_review.

## Conventions
- Every structured response carries an envelope: "summary" (one sentence you can relay as-is) and "next" (suggested follow-up calls with prefilled arguments — follow them instead of guessing tool names).
- All JSON payloads are snake_case and include source URLs back to the hub (${config.siteUrl}).
- Access on this server: ${auth.authed ? `authenticated (scopes: ${[...auth.scopes].join(' ')})` : 'anonymous (self-host mode)'}.
- generate_plan takes ~30-100s and emits progress notifications — send a progressToken to receive them.
- Plans are cached per opportunity; pass force=true to regenerate with the latest data.`);
    },
  );
}
