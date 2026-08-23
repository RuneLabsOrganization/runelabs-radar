'use client';

import * as React from 'react';
import { Check, CornerDownRight, FileCode2, Loader2, Pause, Play, RotateCcw, Terminal } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DEMO_TABS, type DemoStep, type DemoTab } from './script';
import { cn } from '@/lib/utils';

/* ── reveal timing ─────────────────────────────────────────────────────── */

interface Pace {
  /** units revealed per tick */
  inc: number;
  /** ms between ticks */
  delay: number;
}

function unitsIn(step: DemoStep): number {
  switch (step.kind) {
    case 'user':
      return step.text.length;
    case 'assistant':
      return step.text.split(' ').length;
    case 'result':
    case 'file':
      return step.lines.length;
    default:
      return 1;
  }
}

function paceOf(step: DemoStep): Pace {
  switch (step.kind) {
    case 'user':
      return { inc: 2, delay: 32 };
    case 'assistant':
      return { inc: 1, delay: 30 };
    case 'result':
      return { inc: 1, delay: 42 };
    case 'file':
      return { inc: 1, delay: 60 };
    case 'call':
      return { inc: 1, delay: step.runMs };
    case 'chain':
      return { inc: 1, delay: 420 };
  }
}

const STEP_GAP = 420;

/**
 * Walks the transcript one step at a time. `sub` counts revealed units inside
 * the current step (characters, words or lines depending on the step kind).
 *
 * `calm` is the reduced-motion path. It still plays — it just reveals whole
 * steps instead of typing them character by character. Jumping straight to the
 * finished transcript (the old behaviour) read as a broken component to anyone
 * who had OS animations switched off.
 */
function useTranscript(steps: DemoStep[], playing: boolean, calm: boolean) {
  const [cursor, setCursor] = React.useState({ step: 0, sub: 0 });
  const done = cursor.step >= steps.length;

  React.useEffect(() => {
    if (!playing || done) return;
    const step = steps[cursor.step];
    const total = unitsIn(step);

    if (cursor.sub < total) {
      // the tool-call spinner still needs its dwell, or the round trip reads
      // as instant rather than as work being done
      const { inc, delay } = calm
        ? { inc: total, delay: step.kind === 'call' ? step.runMs : 240 }
        : paceOf(step);
      const id = setTimeout(
        () => setCursor((c) => ({ step: c.step, sub: Math.min(total, c.sub + inc) })),
        delay,
      );
      return () => clearTimeout(id);
    }

    const id = setTimeout(
      () => setCursor((c) => ({ step: c.step + 1, sub: 0 })),
      calm ? 650 : STEP_GAP,
    );
    return () => clearTimeout(id);
  }, [cursor, playing, calm, done, steps]);

  const replay = React.useCallback(() => setCursor({ step: 0, sub: 0 }), []);
  const started = cursor.step > 0 || cursor.sub > 0;
  return { cursor, done, started, replay };
}

/* ── syntax colouring ──────────────────────────────────────────────────── */

const TOKENS = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(-?\b\d+(?:\.\d+)?\b)|(\b(?:true|false|null)\b)/g;

function jsonLine(line: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  TOKENS.lastIndex = 0;
  while ((match = TOKENS.exec(line)) !== null) {
    if (match.index > last) out.push(line.slice(last, match.index));
    const cls = match[1]
      ? 'text-ink-2'
      : match[2]
        ? 'text-phosphor'
        : match[3]
          ? 'text-amber'
          : 'text-sector-video';
    out.push(
      <span key={`${match.index}`} className={cls}>
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** Closes a `**` or backtick left dangling by a mid-stream word slice. */
function balance(text: string): string {
  let out = text;
  if ((out.match(/\*\*/g)?.length ?? 0) % 2 === 1) out += '**';
  if ((out.match(/`/g)?.length ?? 0) % 2 === 1) out += '`';
  return out;
}

function prose(text: string): React.ReactNode {
  return balance(text)
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/)
    .filter(Boolean)
    .map((part, i) => {
      if (part.startsWith('**')) {
        return (
          <strong key={i} className="font-semibold text-ink">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('`')) {
        return (
          <code key={i} className="mono rounded bg-scope-2 px-1 py-0.5 text-[11.5px] text-phosphor">
            {part.slice(1, -1)}
          </code>
        );
      }
      return <React.Fragment key={i}>{part}</React.Fragment>;
    });
}

/* ── step rendering ────────────────────────────────────────────────────── */

function CodeBlock({ lines, className }: { lines: string[]; className?: string }) {
  return (
    <pre className={cn('mono overflow-x-auto px-3 py-2 text-[11.5px] leading-[1.65] text-ink-3', className)}>
      {lines.map((l, i) => (
        <div key={i}>{jsonLine(l) || '\u00a0'}</div>
      ))}
    </pre>
  );
}

function StepView({
  step,
  sub,
  complete,
  caret,
}: {
  step: DemoStep;
  sub: number;
  complete: boolean;
  caret: boolean;
}) {
  switch (step.kind) {
    case 'user': {
      const shown = step.text.slice(0, complete ? undefined : sub);
      return (
        <div className="flex gap-3">
          <span className="mono mt-0.5 shrink-0 text-[10px] uppercase tracking-[0.1em] text-ink-4">You</span>
          <p className="text-[13.5px] leading-relaxed text-ink">
            {shown}
            {!complete && caret && (
              <span className="ml-px inline-block w-[7px] animate-pulse text-phosphor">▌</span>
            )}
          </p>
        </div>
      );
    }

    case 'call': {
      return (
        <div className="rounded-lg border border-grat bg-scope-0/70">
          <div className="flex items-center gap-2 border-b border-grat-soft px-3 py-2">
            <Terminal className="h-3.5 w-3.5 shrink-0 text-phosphor" />
            <span className="mono text-[11px] text-ink-3">radar</span>
            <span className="text-ink-4">/</span>
            <span className="mono text-[11px] font-medium text-phosphor">{step.tool}</span>
            <span className="mono ml-auto flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-ink-4">
              {complete ? (
                <>
                  <Check className="h-3 w-3 text-phosphor" /> done
                </>
              ) : (
                <>
                  <Loader2 className="h-3 w-3 animate-spin text-amber" /> running
                </>
              )}
            </span>
          </div>
          <CodeBlock lines={step.args} />
          {!complete && (
            <div className="mono border-t border-grat-soft px-3 py-1.5 text-[10px] text-ink-4">
              {step.running}
              <span className="animate-pulse"> …</span>
            </div>
          )}
        </div>
      );
    }

    case 'result': {
      const lines = complete ? step.lines : step.lines.slice(0, sub);
      return (
        <div className="rounded-lg border border-phosphor/20 bg-scope-0/70">
          <div className="mono flex items-center gap-2 border-b border-grat-soft px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] text-ink-4">
            <CornerDownRight className="h-3 w-3 text-phosphor" />
            {step.meta}
          </div>
          <CodeBlock lines={lines} />
        </div>
      );
    }

    case 'file': {
      const lines = complete ? step.lines : step.lines.slice(0, sub);
      return (
        <div className="rounded-lg border border-amber/25 bg-scope-0/70">
          <div className="mono flex items-center gap-2 border-b border-grat-soft px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] text-ink-4">
            <FileCode2 className="h-3 w-3 text-amber" />
            wrote {step.name}
          </div>
          <pre className="mono overflow-x-auto px-3 py-2 text-[11.5px] leading-[1.65] text-ink-3">
            {lines.map((l, i) => (
              <div key={i} className={l.startsWith('#') ? 'text-ink' : undefined}>
                {l || '\u00a0'}
              </div>
            ))}
          </pre>
        </div>
      );
    }

    case 'assistant': {
      const words = step.text.split(' ');
      const shown = (complete ? words : words.slice(0, sub)).join(' ');
      return (
        <div className="flex gap-3">
          <span className="mono mt-0.5 shrink-0 text-[10px] uppercase tracking-[0.1em] text-phosphor">
            Agent
          </span>
          <p className="text-[13.5px] leading-relaxed text-ink-2">{prose(shown)}</p>
        </div>
      );
    }

    case 'chain': {
      return (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-grat bg-scope-0/40 px-3 py-2">
          <span className="mono text-[10px] uppercase tracking-[0.1em] text-ink-4">next</span>
          <span className="mono rounded bg-phosphor-dim px-1.5 py-0.5 text-[11px] text-phosphor">
            {step.tool}
          </span>
          <span className="text-[12px] text-ink-4">{step.reason}</span>
        </div>
      );
    }
  }
}

/* ── the console ───────────────────────────────────────────────────────── */

function Session({
  tab,
  playing,
  calm,
  onToggle,
}: {
  tab: DemoTab;
  playing: boolean;
  calm: boolean;
  onToggle: () => void;
}) {
  const { cursor, done, started, replay } = useTranscript(tab.steps, playing, calm);
  const scroller = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [cursor]);

  const visible = done ? tab.steps.length : cursor.step + 1;

  return (
    <div className="overflow-hidden rounded-xl border border-grat bg-scope-0 shadow-glow">
      <div className="flex items-center gap-2 border-b border-grat bg-scope-1 px-3 py-2">
        <span aria-hidden className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-grat-strong" />
          <span className="h-2 w-2 rounded-full bg-grat-strong" />
          <span className="h-2 w-2 rounded-full bg-grat-strong" />
        </span>
        <span className="mono ml-2 text-[11px] text-ink-3">
          {tab.client} <span className="text-ink-4">— radar (MCP)</span>
        </span>
        <span className="mono ml-auto hidden items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-ink-4 sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-phosphor" />
          streamable http · oauth 2.1
        </span>
      </div>

      <div ref={scroller} className="h-[440px] space-y-3.5 overflow-y-auto px-4 py-4">
        {!started && !playing ? (
          <div className="flex h-full flex-col items-start justify-center gap-2 text-ink-4">
            <span className="mono text-[10px] uppercase tracking-[0.1em]">Session idle</span>
            <p className="max-w-sm text-[13px] leading-relaxed text-ink-3">
              Press play to watch the round trip, or scroll the console into view.
            </p>
          </div>
        ) : (
          tab.steps.slice(0, visible).map((step, i) => (
            <StepView
              key={i}
              step={step}
              sub={cursor.sub}
              complete={done || i < cursor.step}
              caret={!calm}
            />
          ))
        )}
      </div>

      <div className="mono flex items-center gap-3 border-t border-grat bg-scope-1 px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-ink-4">
        <span className="hidden sm:inline">38 tools · 10 resources · 6 prompts</span>
        <button
          type="button"
          onClick={onToggle}
          aria-label={playing ? 'Pause session' : 'Play session'}
          className="ml-auto inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-ink-3 transition-colors hover:text-phosphor focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {playing ? 'pause' : 'play'}
        </button>
        <button
          type="button"
          onClick={replay}
          className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-ink-3 transition-colors hover:text-phosphor focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <RotateCcw className="h-3 w-3" /> replay
        </button>
      </div>
    </div>
  );
}

/* ── section ───────────────────────────────────────────────────────────── */

const PROPERTIES = [
  {
    title: 'Every payload chains',
    body: 'Each result carries a one-line summary plus prefilled next calls, so your agent moves from signal to plan without guessing tool names or argument shapes.',
  },
  {
    title: 'No API keys',
    body: 'Streamable HTTP with OAuth 2.1. Point your client at the URL, approve the scopes you want — read, plans, batches — and the connection is live.',
  },
  {
    title: 'Reads are free',
    body: 'Browsing signals, the board, stacks and opportunities costs nothing. Only generative work — debates, plans, batch runs — is metered.',
  },
];

export function McpDemo() {
  const [playing, setPlaying] = React.useState(false);
  const [calm, setCalm] = React.useState(false);
  const [active, setActive] = React.useState(DEMO_TABS[0].id);
  const stageRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setCalm(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  React.useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    // Start once the console enters the viewport, then keep going — pausing on
    // every IntersectionObserver tick froze mid-type the same way the hero did
    // (a tall section rarely stays ≥20% visible while you read it).
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setPlaying(true);
      },
      { threshold: 0.05, rootMargin: '120px 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const toggle = React.useCallback(() => setPlaying((p) => !p), []);

  return (
    <section className="border-y border-grat bg-scope-1">
      <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <div className="readout">See it work</div>
        <h2 className="type-h1 mt-2">Your agent, holding the radar</h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-ink-2">
          This is the real tool surface — the same names, arguments and response shapes your client will see
          once you connect. Pick a job and watch the round trip.
        </p>

        <div ref={stageRef} className="mt-8">
          <Tabs value={active} onValueChange={setActive}>
            <TabsList className="flex-wrap">
              {DEMO_TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {DEMO_TABS.map((t) => (
              <TabsContent key={t.id} value={t.id}>
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <Session tab={t} playing={playing} calm={calm} onToggle={toggle} />
                  <aside className="lg:pt-2">
                    <h3 className="type-h2 text-[17px] text-ink">{t.headline}</h3>
                    <p className="mt-3 text-[13px] leading-relaxed text-ink-3">{t.blurb}</p>
                  </aside>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>

        <div className="mt-10 grid gap-6 border-t border-grat pt-8 md:grid-cols-3">
          {PROPERTIES.map((p) => (
            <div key={p.title}>
              <h3 className="mono text-[10.5px] uppercase tracking-[0.1em] text-phosphor">{p.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-3">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
