import Link from 'next/link';
import { ArrowRight, Radar, Layers, Sparkles, Cable } from 'lucide-react';
import { getIdentity } from '@/lib/identity';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import HeroScope from '@/components/hero/HeroScope';
import { McpDemo } from '@/components/mcp-demo/McpDemo';

export const metadata = {
  title: 'Decide your AI tools once. Get back to work.',
  description:
    'A new best-thing ships every week and checking whether it matters is a job nobody pays you for. Radar does that job — for writing, video, design, code and ads. Pick your setup once; we stay quiet until something actually changes.',
};

/**
 * Hero stats are trust signals, not spec sheets. Deliberately NOT "50 MCP
 * tools": tool count is a liability buyers actively try to reduce, and
 * bragging about it tells an informed reader we will eat their context.
 */
const HERO_STATS = [
  { value: '26', label: 'sources read daily' },
  { value: '6', label: 'fields watched' },
  { value: '$0', label: 'vendor money taken' },
  { value: '$19', label: 'per month' },
];

/** The cost of the status quo, in the three currencies people actually feel. */
const TAX = [
  {
    title: 'You lose the hours',
    body: 'Sunday evening, release notes, forty minutes — to find out nothing changed for you.',
  },
  {
    title: 'You lose the money',
    body: 'A tier you outgrew. A tool you replaced in March and never cancelled. A cheaper thing that does the same job, which you would know about if you had been looking.',
  },
  {
    title: 'You lose the work',
    body: 'Your output is capped by a decision you made six months ago, before the better option existed.',
  },
];

const WORKSPACES = [
  {
    icon: Layers,
    title: 'A setup you can stop second-guessing',
    verb: 'What to use',
    body: 'For every job you do — writing, video, design, code, ads — the best pick, the best value, and the cheapest thing that still works. With the reasoning, and what to skip.',
    href: paths.tools,
  },
  {
    icon: Radar,
    title: 'One message when something moves',
    verb: 'What changed',
    body: 'Not another feed. We read six fields every day and stay quiet until something changes that touches what you actually do.',
    href: paths.signal,
  },
  {
    icon: Sparkles,
    title: 'Something worth building next',
    verb: 'What to build',
    body: 'When you want a new project, not a new tool: openings with the demand already evidenced, argued from four sides, and turned into a plan your agent can run.',
    href: paths.build,
  },
];

const TRUST = [
  {
    title: 'Verdicts come from people who used the thing',
    body: 'Not vendor benchmarks, not a press release, not a model’s opinion. We read what users actually report and we count it.',
  },
  {
    title: 'Every pick is dated and graded',
    body: 'You see how much evidence is behind it and when it was last checked. A verdict nobody has re-verified in three months says so, out loud.',
  },
  {
    title: 'We would rather say "we don’t know yet"',
    body: 'Where the evidence is not there, the answer is blank. Filling gaps with a plausible-sounding pick is how the listicles work, and it is why you do not trust them.',
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
            Decide once · then get back to work
          </div>
          <h1 className="type-display mt-4 max-w-3xl text-balance text-ink">
            You&apos;ve spent more time picking AI tools than using them.
          </h1>
          <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-ink-2">
            There&apos;s a new best-thing every week, and checking whether it matters to you is a job nobody pays you
            for. {name} does that job. Pick your setup once — we&apos;ll stay quiet until something actually changes
            enough to be worth switching.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href={paths.tools}>
                See what to use <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={paths.signal}>What changed this week</Link>
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
          <p className="mt-6 max-w-xl text-[12.5px] text-ink-4">
            BCG and UC Riverside surveyed 1,488 workers: productivity peaks at three AI tools, then falls. The problem
            was never finding more tools.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <div className="readout">The status quo</div>
        <h2 className="type-h1 mt-2">The tax nobody bills you for</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {TAX.map((t) => (
            <div key={t.title} className="border-l border-grat pl-4">
              <h3 className="text-[15px] font-medium text-ink">{t.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-3">{t.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <div className="readout">What you get</div>
        <h2 className="type-h1 mt-2">Three answers, so you can stop looking</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {WORKSPACES.map((w) => (
            <Card key={w.title} className="hover-raise transition-colors hover:border-grat">
              <CardHeader>
                <w.icon className="h-5 w-5 text-phosphor" />
                <CardTitle className="mt-2 text-[15px] leading-snug">{w.title}</CardTitle>
                <CardDescription className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-phosphor">
                  {w.verb}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-[13px] leading-relaxed text-ink-3">{w.body}</p>
                <Link
                  href={w.href}
                  className="mt-4 inline-flex items-center gap-1 text-[12.5px] text-phosphor hover:underline"
                >
                  Show me <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-grat bg-scope-0/40">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <div className="readout">Why believe it</div>
          <h2 className="type-h1 mt-2 max-w-2xl text-balance">
            We don&apos;t guess, and nobody pays us to recommend anything.
          </h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {TRUST.map((t) => (
              <div key={t.title}>
                <h3 className="text-[14px] font-medium text-ink">{t.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-3">{t.body}</p>
              </div>
            ))}
          </div>
          <Link
            href={paths.trust}
            className="mt-8 inline-flex items-center gap-1 text-[12.5px] text-phosphor hover:underline"
          >
            How we grade a verdict <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      <McpDemo />

      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="readout">For people who code</div>
            <h2 className="type-h1 mt-2">Your agent should know your setup too</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
              If you build with Claude Code, Cursor or Codex, connect {name} once. Your agent stops suggesting the
              stack you already rejected, stops re-researching what you&apos;ve settled, and stops burning context
              reading the internet — so it spends that context on your code instead.
            </p>
            <Button asChild className="mt-6">
              <Link href={paths.mcp}>
                <Cable className="h-4 w-4" /> Connect in two lines
              </Link>
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
        <h2 className="type-h1">Three tools, not seven.</h2>
        <p className="mx-auto mt-3 max-w-lg text-[14px] text-ink-3">
          Start free. Everything you need to decide costs nothing. You pay when you want {name} doing work for you,
          not just telling you things.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild size="lg">
            <Link href={paths.signup}>Set up my stack</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={paths.pricing}>See pricing</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
