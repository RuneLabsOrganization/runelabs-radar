import Link from 'next/link';
import { ArrowRight, Radar, Layers, Sparkles, Cable } from 'lucide-react';
import { getIdentity } from '@/lib/identity';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PUBLISHED_SAVINGS, fmtTokens } from '@/lib/mcp-savings-copy';
import HeroScope from '@/components/hero/HeroScope';
import { McpDemo } from '@/components/mcp-demo/McpDemo';

export const metadata = {
  title: 'AI intelligence for builders',
  description:
    'Radar does the research so your coding agent does not. Compact MCP lookups, ask_radar synthesis, and a receipt of tokens saved — what changed, what to use, what to build.',
};

const HERO_STATS = [
  { value: `~${fmtTokens(PUBLISHED_SAVINGS.compactAvgSavedVsDiy)}`, label: 'tokens saved / lookup' },
  { value: '50', label: 'MCP tools' },
  { value: '6', label: 'domains watched' },
  { value: 'OAuth 2.1', label: 'no API keys' },
];

const WORKSPACES = [
  {
    icon: Radar,
    title: 'Signal',
    verb: 'What changed',
    body: 'Live intelligence across coding, copy, image, video, ads, and agents — briefs, topic maps, and the stories that matter.',
    href: paths.signal,
  },
  {
    icon: Layers,
    title: 'Decide',
    verb: 'What to use',
    body: 'Best-right-now tools, venture stacks, coding-agent playbooks, and cost-intelligence metrics — ranked for builders, not benchmarks.',
    href: paths.decide,
  },
  {
    icon: Sparkles,
    title: 'Build',
    verb: 'What to build',
    body: 'Monetizable openings, multi-role debates, and Batches that turn ideas into execution plans your agent can run — Radar spends the research tokens, not you.',
    href: paths.build,
  },
];

export default function LandingPage() {
  const name = getIdentity().productName;
  return (
    <div>
      <section className="relative isolate flex min-h-[600px] items-center overflow-hidden border-b border-grat lg:min-h-[680px]">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <HeroScope intensity={0.92} />
        </div>
        {/* keep the copy legible over the field without flattening it */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-scope-0 from-15% via-scope-0/55 via-45% to-transparent to-72%"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-scope-0 to-transparent"
        />

        <div className="relative mx-auto w-full max-w-[1100px] px-4 py-20 sm:px-6 sm:py-24">
          <div className="readout inline-flex items-center gap-2 text-phosphor">
            <span aria-hidden className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-phosphor opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-phosphor" />
            </span>
            MCP-first · research so your agent does not
          </div>
          <h1 className="type-display mt-4 max-w-3xl text-balance text-ink">
            Radar does the research. Your agent keeps coding.
          </h1>
          <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-ink-2">
            {name} watches the AI field and answers what changed, what to use, what to build — as compact briefs,
            not page dumps. A typical lookup returns ~{PUBLISHED_SAVINGS.compactAvgReturned} tokens and keeps ~
            {fmtTokens(PUBLISHED_SAVINGS.compactAvgSavedVsDiy)} out of your coding agent&apos;s context vs doing the
            research locally.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href={paths.app}>
                Open the app <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={paths.mcp}>
                <Cable className="h-4 w-4" /> Connect your agent
              </Link>
            </Button>
          </div>
          <dl className="mono mt-10 flex flex-wrap gap-x-8 gap-y-3 text-[10.5px] uppercase tracking-[0.1em] text-ink-4">
            {HERO_STATS.map((s) => (
              <div key={s.label}>
                <dt className="sr-only">{s.label}</dt>
                <dd>
                  <span className="text-[15px] tracking-normal text-ink">{s.value}</span>{' '}
                  <span>{s.label}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-[12.5px] text-ink-4">
            Compact reads are free. ask_radar, plans, and debates are for members — with a savings receipt on every
            call.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <div className="readout">Three verbs · four workspaces</div>
        <h2 className="type-h1 mt-2">Signal → Decide → Build → Connect</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {WORKSPACES.map((w) => (
            <Card key={w.title} className="hover-raise transition-colors hover:border-grat">
              <CardHeader>
                <w.icon className="h-5 w-5 text-phosphor" />
                <CardTitle className="mt-2">{w.title}</CardTitle>
                <CardDescription className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-phosphor">
                  {w.verb}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-[13px] leading-relaxed text-ink-3">{w.body}</p>
                <Link href={w.href} className="mt-4 inline-flex items-center gap-1 text-[12.5px] text-phosphor hover:underline">
                  Enter <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <McpDemo />

      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="readout">Two lines to connect</div>
            <h2 className="type-h1 mt-2">Point your client at the URL</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
              Drop this into Cursor, Claude, Zed, or anything else that speaks MCP. Start with{' '}
              <span className="mono text-ink">ask_radar</span> — Radar synthesizes server-side so your model does not
              fetch four tools and re-read the evidence.
            </p>
            <Button asChild className="mt-6">
              <Link href={paths.mcp}>See the MCP surface</Link>
            </Button>
          </div>
          <Card className="border-phosphor/20 bg-scope-0 shadow-glow">
            <CardContent className="p-5">
              <pre className="mono overflow-x-auto text-[11.5px] leading-relaxed text-phosphor">{`{
  "mcpServers": {
    "radar": {
      "url": "https://radar.runelabs.org/mcp"
    }
  }
}`}</pre>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-16 text-center sm:px-6">
        <h2 className="type-h1">Start free. Upgrade when you act.</h2>
        <p className="mx-auto mt-3 max-w-lg text-[14px] text-ink-3">
          Compact reads are free. Members get synthesis, plans, and a private workspace. One research-to-plan session
          keeps ~{fmtTokens(PUBLISHED_SAVINGS.sessionDiySaved)} tokens out of your agent — artifact pricing, not a
          token bill.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild size="lg">
            <Link href={paths.signup}>Create account</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={paths.pricing}>View pricing</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
