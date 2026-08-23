import { config } from '@/lib/config';
import { requireViewer } from '@/lib/auth/user';
import PageHeader from '@/components/PageHeader';
import CopyButton from '@/components/CopyButton';
import ConnectHealth from '@/components/ConnectHealth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';

export const metadata = {
  title: 'Connect your agent — MCP',
  description:
    'Point any MCP-compatible AI agent at this Radar instance: 26 intelligence tools, workflow prompts, and the opportunity→plan flagship flow.',
};

function Snippet({ title, note, code }: { title: string; note?: string; code: string }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-0">
        <CardTitle className="readout font-medium normal-case tracking-[0.12em] text-ink-2">{title}</CardTitle>
        <CopyButton text={code} label="copy" />
      </CardHeader>
      <CardContent className="space-y-2 pt-3">
        {note && <p className="text-[12px] text-ink-4">{note}</p>}
        <pre className="mono overflow-x-auto rounded-md border border-grat bg-scope-2 p-3 text-[11.5px] leading-relaxed text-ink-2">
          {code}
        </pre>
      </CardContent>
    </Card>
  );
}

export default async function ConnectPage() {
  await requireViewer();
  const mcpUrl = (process.env.MCP_PUBLIC_URL ?? `${config.siteUrl.replace(/\/+$/, '')}/mcp`).replace(/\/+$/, '');
  const authRequired = process.env.MCP_AUTH_REQUIRED === 'true';

  return (
    <main className="mx-auto max-w-[760px] space-y-6">
      <PageHeader
        kicker="MCP SERVER"
        title="Connect your agent"
        description="Every intelligence surface on this Radar — briefs, signals, board, stacks, opportunities, pains, market prices, forecasts, and batches — is callable by your AI agent, plus the flagship generate_plan flow."
      />

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-0">
          <CardTitle className="readout font-medium normal-case tracking-[0.12em] text-ink-2">
            Endpoint (streamable HTTP)
          </CardTitle>
          <CopyButton text={mcpUrl} label="copy url" />
        </CardHeader>
        <CardContent className="space-y-2 pt-3">
          <pre className="mono overflow-x-auto rounded-md border border-grat bg-scope-2 p-3 text-[12.5px] text-phosphor">
            {mcpUrl}
          </pre>
          <p className="text-[12px] text-ink-4">
            {authRequired
              ? 'This server requires OAuth 2.1 — your client will open a login/consent screen on first connect. No keys to copy.'
              : 'This server is in self-host anonymous mode — no login needed, just the URL.'}
            {!process.env.MCP_PUBLIC_URL &&
              ' Local dev without a reverse proxy: the MCP process listens on its own port — use http://127.0.0.1:3122/mcp.'}
          </p>
        </CardContent>
      </Card>

      <ConnectHealth />

      <SectionHeader label="Client setup" className="mt-0" />
      <div className="space-y-3">
        <Snippet title="Claude Code" code={`claude mcp add --transport http radar ${mcpUrl}`} />
        <Snippet
          title="Claude Desktop"
          note="Settings → Developer → Edit Config, then restart"
          code={`{\n  "mcpServers": {\n    "radar": {\n      "type": "http",\n      "url": "${mcpUrl}"\n    }\n  }\n}`}
        />
        <Snippet
          title="Cursor"
          note="Settings → MCP → New MCP Server"
          code={`{\n  "mcpServers": {\n    "radar": {\n      "type": "http",\n      "url": "${mcpUrl}"\n    }\n  }\n}`}
        />
        <Snippet
          title="ChatGPT / other clients"
          note="Any MCP client with streamable-HTTP support works — paste the endpoint URL as a new connector/server"
          code={mcpUrl}
        />
        <Snippet
          title="Verify the connection"
          note="Lists all tools including batches"
          code={`curl -X POST ${mcpUrl} \\\n  -H 'content-type: application/json' \\\n  -H 'accept: application/json, text/event-stream' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`}
        />
      </div>

      <SectionHeader label="First plan in 5 minutes" className="mt-0" />
      <Card>
        <CardContent className="pt-4">
          <ol className="space-y-2.5 text-[12.5px] leading-relaxed text-ink-3">
            <li>
              <span className="mono text-phosphor">1.</span>{' '}
              <strong className="text-ink-2">Connect your client</strong> — one of the snippets above. First connect
              opens a login/consent screen (self-host anonymous mode: just the URL, no login).
            </li>
            <li>
              <span className="mono text-phosphor">2.</span>{' '}
              <strong className="text-ink-2">Pick an opening</strong> — ask your agent for{' '}
              <span className="mono">get_opportunities</span>. You get ranked opportunities back, each with a{' '}
              <span className="mono">slug</span>; choose one worth building.
            </li>
            <li>
              <span className="mono text-phosphor">3.</span>{' '}
              <strong className="text-ink-2">Generate the plan</strong> —{' '}
              <span className="mono">{'generate_plan({ opportunity: "<slug>" })'}</span>. Takes ~30-100s (6-7 LLM
              calls) and emits progress while it works. Free tier includes 3 plans/mo; cached replays don&apos;t burn
              quota.
            </li>
            <li>
              <span className="mono text-phosphor">4.</span>{' '}
              <strong className="text-ink-2">Export the document</strong> —{' '}
              <span className="mono">{'get_plan({ opportunity: "<slug>", format: "markdown" })'}</span>. Save the
              markdown as <span className="mono">PLAN.md</span> in your repo.
            </li>
            <li>
              <span className="mono text-phosphor">5.</span>{' '}
              <strong className="text-ink-2">Execute</strong> — hand <span className="mono">PLAN.md</span> to your
              local coding agent and let it work the task graph: validation → build → launch → GTM → revenue, with
              acceptance criteria and rollback notes per task.
            </li>
          </ol>
          <p className="mt-3 text-[12px] text-ink-4">
            If the agent stalls on any step, have it call <span className="mono">get_server_guide</span> — the live
            tour, written for agents.
          </p>
        </CardContent>
      </Card>

      <SectionHeader label="What your agent gets" className="mt-0" />
      <Card>
        <CardContent className="pt-4">
          <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-ink-3">
            <li>
              <strong className="text-ink-2">News:</strong> get_daily_brief, get_top_signals, search_stories,
              get_story, get_domain_digest, get_daily_insights
            </li>
            <li>
              <strong className="text-ink-2">Decisions:</strong> get_best_right_now, get_board_changes,
              get_market_models, list_stacks, get_stack_for, list_agent_stacks, get_agent_stack_for
            </li>
            <li>
              <strong className="text-ink-2">Ideas:</strong> get_opportunities, get_opportunity, get_pain_points,
              get_comps, get_launches, get_patterns, get_topic_map
            </li>
            <li>
              <strong className="text-ink-2">Execution:</strong> generate_plan, get_plan, list_batches, create_batch,
              add_to_batch, run_batch, get_batch_run
            </li>
            <li>
              <strong className="text-ink-2">Data:</strong> list_metrics, get_metric_series, get_forecasts,
              get_accuracy, get_entity
            </li>
            <li>
              <strong className="text-ink-2">Prompts:</strong> find_and_plan, whats_new_today, what_should_i_use,
              which_agent_stack, validate_idea, builder_weekly_review
            </li>
          </ul>
          <p className="mt-3 text-[12px] text-ink-4">
            Every response carries a one-line <span className="mono">summary</span> and suggested{' '}
            <span className="mono">next</span> calls — agents chain workflows without guessing. Call{' '}
            <span className="mono">get_server_guide</span> from your agent for the live tour.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
