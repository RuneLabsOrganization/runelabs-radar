import Link from 'next/link';
import { paths } from '@/lib/urls';
import { config } from '@/lib/config';
import { PUBLISHED_SAVINGS, fmtTokens } from '@/lib/mcp-savings-copy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import CopyButton from '@/components/CopyButton';

export const metadata = {
  title: 'Connect your agent',
  description:
    'Connect Radar once and your coding agent stops re-researching what you have already settled — and stops spending its context reading the internet instead of your code. Two lines, no API keys.',
};

/** Grouped by the job, not by subsystem — the reader is deciding what to ask for. */
const TOOL_GROUPS = [
  { title: 'Just ask it something', tools: ['ask_radar', 'whats_relevant', 'decide', 'get_my_usage'] },
  { title: 'Catch me up', tools: ['get_daily_brief', 'get_top_signals', 'search_stories', 'get_weekly_report'] },
  { title: 'Find me something to build', tools: ['get_opportunities', 'scout_opportunities', 'debate_idea', 'get_pain_points'] },
  { title: 'Turn it into a plan', tools: ['generate_plan', 'get_plan', 'list_batches', 'run_batch'] },
  { title: 'Remember what I care about', tools: ['watch', 'get_since', 'set_profile', 'get_session'] },
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
      <div className="readout text-phosphor">For people who code</div>
      <h1 className="type-h1 mt-2">Give your agent the answers you already paid for.</h1>
      <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-2">
        Sixty seconds to connect, no API keys. After that your agent stops re-litigating decisions you settled months
        ago, stops proposing the stack you already rejected, and stops burning its context window reading the internet
        — so it spends that context on your code instead. Answers come back small on purpose: a typical lookup is
        about {PUBLISHED_SAVINGS.compactAvgReturned} tokens, not a page dump.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-[12px]">~{fmtTokens(PUBLISHED_SAVINGS.compactAvgSavedVsDiy)}</CardTitle>
            <CardDescription>tokens your agent doesn&apos;t spend looking this up itself</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-[12px]">~{PUBLISHED_SAVINGS.weeklyFullVsCompact}×</CardTitle>
            <CardDescription>less context eaten by the weekly read-up</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-[12px]">~{fmtTokens(PUBLISHED_SAVINGS.sessionDiySaved)}</CardTitle>
            <CardDescription>context left free after a full idea-to-plan session</CardDescription>
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

      {/* Grouped by the job it does, deliberately not headlined with a tool
          count — a long tool list is a context cost to the reader, not a brag. */}
      <SectionHeader label="what your agent can ask for" />
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
