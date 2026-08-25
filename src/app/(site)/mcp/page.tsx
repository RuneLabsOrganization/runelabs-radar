import Link from 'next/link';
import { paths } from '@/lib/urls';
import { config } from '@/lib/config';
import { PUBLISHED_SAVINGS, fmtTokens } from '@/lib/mcp-savings-copy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import CopyButton from '@/components/CopyButton';

export const metadata = {
  title: 'MCP — connect your agent',
  description:
    'Radar does the research so your coding agent does not. Compact MCP lookups (~8k tokens saved vs DIY), ask_radar synthesis, plans, and a savings receipt on every call.',
};

const TOOL_GROUPS = [
  { title: 'Jobs', tools: ['ask_radar', 'whats_relevant', 'decide', 'get_my_usage'] },
  { title: 'News', tools: ['get_daily_brief', 'get_top_signals', 'search_stories', 'get_weekly_report'] },
  { title: 'Ideas', tools: ['get_opportunities', 'scout_opportunities', 'debate_idea', 'get_pain_points'] },
  { title: 'Execution', tools: ['generate_plan', 'get_plan', 'list_batches', 'run_batch'] },
  { title: 'Workspace', tools: ['watch', 'get_since', 'set_profile', 'get_session'] },
];

export default function McpMarketingPage() {
  const mcpUrl = (process.env.MCP_PUBLIC_URL ?? `${config.siteUrl.replace(/\/+$/, '')}/mcp`).replace(/\/+$/, '');
  const snippet = JSON.stringify(
    { mcpServers: { radar: { url: mcpUrl } } },
    null,
    2,
  );

  return (
    <div className="mx-auto max-w-[860px] px-4 py-12 sm:px-6">
      <div className="readout text-phosphor">Agent surface</div>
      <h1 className="type-h1 mt-2">Radar researches. Your agent codes.</h1>
      <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-2">
        Connect in 60 seconds. Prefer <span className="mono text-ink">ask_radar</span> over fetching four tools: a
        typical compact lookup returns ~{PUBLISHED_SAVINGS.compactAvgReturned} tokens and keeps ~
        {fmtTokens(PUBLISHED_SAVINGS.compactAvgSavedVsDiy)} out of your context vs doing the research locally. Reads
        stay compact and free; plans, debates, and asks use membership quota. Every response includes an{' '}
        <span className="mono text-ink">economy</span> receipt.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-[12px]">~{fmtTokens(PUBLISHED_SAVINGS.compactAvgSavedVsDiy)}</CardTitle>
            <CardDescription>DIY tokens kept out of your agent per compact lookup</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-[12px]">~{PUBLISHED_SAVINGS.weeklyFullVsCompact}×</CardTitle>
            <CardDescription>smaller weekly brief vs dumping the full issue</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-[12px]">~{fmtTokens(PUBLISHED_SAVINGS.sessionDiySaved)}</CardTitle>
            <CardDescription>saved in one ask → dossier → plan session</CardDescription>
          </CardHeader>
        </Card>
      </div>

      <SectionHeader label="1 · add the server" />
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="font-mono text-[12px]">mcp.json</CardTitle>
            <CardDescription>Paste into your client&apos;s MCP config</CardDescription>
          </div>
          <CopyButton text={snippet} />
        </CardHeader>
        <CardContent>
          <pre className="mono overflow-x-auto rounded-md border border-grat bg-scope-0 p-3 text-[11.5px] text-phosphor">
            {snippet}
          </pre>
        </CardContent>
      </Card>

      <SectionHeader label="2 · authorize" />
      <Card>
        <CardContent className="p-4 text-[13px] leading-relaxed text-ink-2">
          On first use your client opens OAuth. Sign in once, approve <span className="mono text-ink">read</span> and{' '}
          <span className="mono text-ink">plans</span> scopes. No API keys to copy or rotate.
        </CardContent>
      </Card>

      <SectionHeader label="3 · first plan" />
      <Card>
        <CardContent className="space-y-2 p-4 text-[13px] text-ink-2">
          <p>Ask your agent:</p>
          <blockquote className="border-l-2 border-phosphor pl-3 text-ink italic">
            &ldquo;Use ask_radar to find a pursue-grade opportunity, then generate_plan.&rdquo;
          </blockquote>
          <p className="text-ink-3">
            Flow: <span className="mono text-ink-2">ask_radar</span> →{' '}
            <span className="mono text-ink-2">get_opportunity</span> →{' '}
            <span className="mono text-ink-2">generate_plan</span>
          </p>
        </CardContent>
      </Card>

      <SectionHeader label="tool catalog" count={TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0) + '+'} />
      <div className="grid gap-3 sm:grid-cols-2">
        {TOOL_GROUPS.map((g) => (
          <Card key={g.title}>
            <CardHeader>
              <CardTitle className="readout !text-phosphor">{g.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {g.tools.map((t) => (
                  <li key={t} className="mono text-[11.5px] text-ink-2">
                    {t}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Button asChild>
          <Link href={paths.connect}>Open in-app Connect</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={paths.pricing}>Pricing</Link>
        </Button>
      </div>
    </div>
  );
}
