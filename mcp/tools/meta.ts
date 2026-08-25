import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { count, eq, gte } from 'drizzle-orm';
import { getDb } from '../../src/lib/db';
import { launches, opportunities, stacks, stories } from '../../src/lib/db/schema';
import { getIdentity } from '../../src/lib/identity';
import { config } from '../../src/lib/config';
import { text } from '../lib/payload';
import type { AuthContext } from '../lib/auth';

/**
 * Orientation for a freshly-connected agent: jobs first, specialists as depth.
 * Markdown on purpose — this one is for the model to read, not to parse.
 */
export function registerMetaTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'get_server_guide',
    {
      description:
        'What this server offers and how to use it: start with jobs (ask_radar, whats_relevant, decide), then specialists for depth. Call this first if you are unsure which tool to use.',
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

## Promise
Radar does the research so your coding agent does not. Prefer ONE job tool over four specialist fetches. Every structured response carries summary + next + economy (tokens returned / saved vs full dump / saved vs DIY research).

## What this server knows (live counts)
- ${stats.curated_stories} curated stories, scored per domain (coding, copy, image, video, ads, agentic)
- ${stats.active_opportunities} active monetizable opportunities, adversarially reviewed
- ${stats.stack_playbooks} venture stack playbooks
- ${stats.launches_7d} product launches in the last 7 days

## Jobs (start here)
- **ask_radar** — natural-language question → grounded brief (server synthesizes; you do not call 8 tools)
- **whats_relevant** — given your project, what on Radar matters right now
- **decide** — what model/tool to use for a task (board + market in one shot)
- **debate_idea** / **scout_opportunities** / **generate_plan** — heavy artifacts (metered)
- **get_my_usage** — your quota + token-savings receipt this cycle
- **get_since** / **watch** — incremental deltas (limitless research without re-dumps)
- **get_profile** / **set_profile** / **get_session** / **set_session** — personalization + memory

## Flagship workflow: opportunity → plan
1. ask_radar OR get_opportunities → pick one
2. get_opportunity (detail=compact) → scores/KPIs without a dossier dump
3. generate_plan (format=markdown) → save as PLAN.md and execute locally

Guided prompts: **find_and_plan**, whats_new_today, what_should_i_use, which_agent_stack, validate_idea, builder_weekly_review.

## Specialists (optional depth)
- News: get_daily_brief, get_domain_digest, get_daily_insights, get_top_signals, search_stories, get_story, get_weekly_report
- Decisions: get_best_right_now, get_board_changes, get_market_models, list_stacks, get_stack_for, list_agent_stacks, get_agent_stack_for
- Ideas: get_opportunities, get_opportunity, get_pain_points, get_comps, get_launches, get_patterns, get_topic_map
- Execution: generate_plan, get_plan, batches
- Data: list_metrics, get_metric_series, get_forecasts, get_accuracy, get_entity

## Conventions
- Prefer detail=compact (default). Pass detail=full only when you need the dossier.
- generate_plan returns ONE format (markdown default) — not JSON+markdown together.
- economy on every structured response is the ROI receipt, not a bill (artifact pricing stays).
- Access: ${auth.authed ? `authenticated (scopes: ${[...auth.scopes].join(' ')})` : 'anonymous (self-host mode)'}.
- Hub: ${config.siteUrl}`);
    },
  );
}
