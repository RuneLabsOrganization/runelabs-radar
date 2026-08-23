import Link from 'next/link';
import { ArrowRight, Radar, Layers, Sparkles, Cable } from 'lucide-react';
import { getIdentity } from '@/lib/identity';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import RadarBackdrop from '@/components/RadarBackdrop';

export const metadata = {
  title: 'AI intelligence for builders',
  description:
    'Radar fetches the best tech, stacks, and opportunities for creators building with AI. MCP-ready: what changed, what to use, what to build.',
};

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
    body: 'Monetizable openings, multi-role debates, and Batches that turn ideas into execution plans your agent can run.',
    href: paths.build,
  },
];

export default function LandingPage() {
  const name = getIdentity().productName;
  return (
    <div>
      <section className="relative overflow-hidden border-b border-grat">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-40">
          <RadarBackdrop intensity={0.18} />
        </div>
        <div className="relative mx-auto max-w-[1100px] px-4 py-20 sm:px-6 sm:py-28">
          <div className="readout text-phosphor">MCP-ready · for creators building with AI</div>
          <h1 className="type-display mt-4 max-w-3xl text-ink">
            The best tech, stacks, and opportunities — always on your radar.
          </h1>
          <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-ink-2">
            {name} watches the whole AI field and turns it into three answers: what changed, what to use, what to
            build. Then it hands the answer to your agent over MCP.
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
          <p className="mt-4 text-[12.5px] text-ink-4">
            Free to browse. Plans, debates, and batches for members.
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

      <section className="border-y border-grat bg-scope-1">
        <div className="mx-auto grid max-w-[1100px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="readout">The product is MCP</div>
            <h2 className="type-h1 mt-2">Hand your agent the plan</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
              Thirty-plus tools over Streamable HTTP. Browse signals, debate ideas, scout openings, and generate
              execution plans — from Cursor, Claude, or any MCP client. OAuth 2.1. No API keys to copy.
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
          Every read is free and unlimited. Debates, plans, and Batches are for members — artifact pricing, not
          tokens.
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
