'use client';

import * as React from 'react';
import { flushSync } from 'react-dom';
import { Check, CornerDownRight, FileCode2, Loader2, Pause, Play, RotateCcw, Terminal } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DEMO_TABS, type DemoStep, type DemoTab } from './script';
import { PUBLISHED_SAVINGS, fmtTokens } from '@/lib/mcp-savings-copy';
import { cn } from '@/lib/utils';

/* ── reveal timing ─────────────────────────────────────────────────────── */

/**
 * Splits prose into pseudo-BPE tokens. Whitespace binds to the token that
 * follows it and long words break into pieces, so the stream lands mid-word the
 * way a real model's does instead of snapping to whole words. Chunk sizes are
 * derived from the offset rather than randomised — tokenising has to return the
 * same array on every render.
 *
 * Words carrying markdown stay whole so a chunk boundary can never split `**`
 * into a stray marker that renders as a literal asterisk.
 */
function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const word of text.match(/\s*\S+/g) ?? []) {
    if (word.trim().length <= 6 || /[*`]/.test(word)) {
      out.push(word);
      continue;
    }
    let i = 0;
    while (i < word.length) {
      const size = i === 0 ? 5 : 3 + ((word.length + i) % 3);
      out.push(word.slice(i, i + size));
      i += size;
    }
  }
  return out;
}

/** Steps are module constants, so their token arrays are cached by identity. */
const tokenCache = new WeakMap<DemoStep, string[]>();

function tokensOf(step: DemoStep & { kind: 'assistant' }): string[] {
  let cached = tokenCache.get(step);
  if (!cached) {
    cached = tokenize(step.text);
    tokenCache.set(step, cached);
  }
  return cached;
}

/** Joined payload for character-streamed code blocks. */
function payloadOf(step: DemoStep & { kind: 'result' | 'file' }): string {
  return step.lines.join('\n');
}

function unitsIn(step: DemoStep): number {
  switch (step.kind) {
    case 'user':
      return step.text.length;
    case 'assistant':
      return tokensOf(step).length;
    case 'result':
    case 'file':
      // Characters, not lines — whole-line reveals read as "chunky streaming"
      // even when the rAF loop itself is healthy (the JSON phase is most of
      // the screen time on every tab).
      return payloadOf(step).length;
    default:
      return 1;
  }
}

/**
 * Units revealed per second. `call` and `chain` are single-unit beats, so their
 * rate is just the inverse of the dwell they want.
 */
function rateOf(step: DemoStep): number {
  switch (step.kind) {
    case 'user':
      return 55; // characters — a human typing at a good clip
    case 'assistant':
      return 42; // pseudo-tokens ≈ 190 chars/s, a flagship model's pace
    case 'result':
      return 160; // characters — tool JSON arriving over the wire
    case 'file':
      return 120; // characters
    case 'call':
      return 1000 / step.runMs;
    case 'chain':
      return 1000 / 420;
  }
}

/**
 * Hard cap on units committed in a single paint. Without this, a hitch from the
 * hero WebGL (or any long frame) spends the accumulated credit as a burst —
 * which is exactly the "goes by chunks on live, smooth on idle local" texture.
 */
function maxGainOf(step: DemoStep): number {
  switch (step.kind) {
    case 'user':
      return 2;
    case 'assistant':
      return 2;
    case 'result':
    case 'file':
      return 4;
    default:
      return 1;
  }
}

/** Dead air before a step emits anything — the model's time to first token. */
function leadInOf(step: DemoStep): number {
  switch (step.kind) {
    case 'assistant':
      return 300;
    case 'user':
      return 140;
    case 'result':
      return 90;
    default:
      return 0;
  }
}

const STEP_GAP = 380;

/** Visible text for `sub` units of a streamable step. */
function textAt(step: DemoStep, sub: number): string {
  switch (step.kind) {
    case 'user':
      return step.text.slice(0, sub);
    case 'assistant':
      return tokensOf(step).slice(0, sub).join('');
    case 'result':
    case 'file':
      return payloadOf(step).slice(0, sub);
    default:
      return '';
  }
}

/**
 * Drives the transcript. Hot-path reveals write straight to a DOM node via
 * `textContent` — they never touch React. React only re-renders when a step
 * boundary is crossed (a few times per demo), which is what keeps the stream
 * smooth under production concurrent rendering and the hero WebGL load.
 *
 * `prefers-reduced-motion` is intentionally ignored: collapsing into whole-step
 * dumps made the console look broken on Windows machines with OS animations
 * off. Pause is the accessibility affordance.
 */
function useTranscript(steps: DemoStep[], playing: boolean) {
  /** How many steps are fully finished and owned by React. */
  const [committed, setCommitted] = React.useState(0);
  const [runId, setRunId] = React.useState(0);
  const [armed, setArmed] = React.useState(false);
  const hostRef = React.useRef<HTMLElement | null>(null);
  const committedRef = React.useRef(0);
  const stepsRef = React.useRef(steps);
  stepsRef.current = steps;

  const replay = React.useCallback(() => {
    committedRef.current = 0;
    setCommitted(0);
    setArmed(false);
    if (hostRef.current) hostRef.current.textContent = '';
    setRunId((n) => n + 1);
  }, []);

  React.useEffect(() => {
    if (!playing) return;
    setArmed(true);

    let raf = 0;
    let alive = true;
    let stepIdx = committedRef.current;
    let sub = 0;
    let emittedAt = 0;
    let holdUntil = 0;
    let rate = 1;

    const list = () => stepsRef.current;

    const beginStep = (now: number, gap = 0) => {
      const step = list()[stepIdx];
      if (!step) return;
      sub = 0;
      emittedAt = 0;
      rate = rateOf(step) * (0.85 + Math.random() * 0.3);
      if (step.kind === 'call') {
        holdUntil = now + gap + step.runMs;
      } else if (step.kind === 'chain') {
        holdUntil = now + gap + 420;
      } else {
        holdUntil = now + gap + leadInOf(step);
      }
      if (hostRef.current) hostRef.current.textContent = '';
    };

    if (stepIdx < list().length) beginStep(performance.now());
    else holdUntil = Infinity;

    const paintHost = (step: DemoStep, nextSub: number) => {
      const el = hostRef.current;
      if (!el) return false;
      el.textContent = textAt(step, nextSub);
      return true;
    };

    const commitStep = (now: number) => {
      stepIdx += 1;
      committedRef.current = stepIdx;
      // Step boundaries only — a handful of React commits per demo.
      flushSync(() => setCommitted(stepIdx));
      sub = 0;
      if (stepIdx < list().length) beginStep(now, STEP_GAP);
    };

    const frame = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);

      const stepsNow = list();
      if (stepIdx >= stepsNow.length) return;

      const step = stepsNow[stepIdx]!;
      if (now < holdUntil) return;

      const total = unitsIn(step);

      // call / chain: dwell already spent in holdUntil, then commit
      if (step.kind === 'call' || step.kind === 'chain') {
        commitStep(now);
        return;
      }

      if (emittedAt === 0) emittedAt = now;

      if (sub >= total) {
        commitStep(now);
        return;
      }

      if (step.kind === 'assistant' && Math.random() < 0.003) {
        holdUntil = now + 40 + Math.random() * 80;
        emittedAt = now - (sub / rate) * 1000;
        return;
      }

      const target = Math.floor(((now - emittedAt) / 1000) * rate);
      const nextSub = Math.min(total, sub + Math.min(maxGainOf(step), Math.max(0, target - sub)));
      if (nextSub === sub) return;

      if (!paintHost(step, nextSub)) {
        // Host not mounted yet (React hasn't committed the shell) — try again
        // next frame without advancing the clock.
        emittedAt = now - (sub / rate) * 1000;
        return;
      }
      sub = nextSub;
    };

    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [playing, runId]);

  const done = committed >= steps.length;
  const streaming = playing && !done ? steps[committed] : null;
  return { committed, streaming, hostRef, done, started: armed || committed > 0, replay };
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

/**
 * Finished steps only — the in-progress step is a StreamingShell that the rAF
 * loop writes into without React.
 */
const StepView = React.memo(function StepView({
  step,
  complete = true,
}: {
  step: DemoStep;
  complete?: boolean;
}) {
  switch (step.kind) {
    case 'user':
      return (
        <div className="flex gap-3">
          <span className="mono mt-0.5 shrink-0 text-[10px] uppercase tracking-[0.1em] text-ink-4">You</span>
          <p className="text-[13.5px] leading-relaxed text-ink">{step.text}</p>
        </div>
      );

    case 'call':
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

    case 'result':
      return (
        <div className="rounded-lg border border-phosphor/20 bg-scope-0/70">
          <div className="mono flex items-center gap-2 border-b border-grat-soft px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] text-ink-4">
            <CornerDownRight className="h-3 w-3 text-phosphor" />
            {step.meta}
          </div>
          <CodeBlock lines={step.lines} />
        </div>
      );

    case 'file':
      return (
        <div className="rounded-lg border border-amber/25 bg-scope-0/70">
          <div className="mono flex items-center gap-2 border-b border-grat-soft px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] text-ink-4">
            <FileCode2 className="h-3 w-3 text-amber" />
            wrote {step.name}
          </div>
          <pre className="mono overflow-x-auto px-3 py-2 text-[11.5px] leading-[1.65] text-ink-3">
            {step.lines.map((l, i) => (
              <div key={i} className={l.startsWith('#') ? 'text-ink' : undefined}>
                {l || '\u00a0'}
              </div>
            ))}
          </pre>
        </div>
      );

    case 'assistant':
      return (
        <div className="flex gap-3">
          <span className="mono mt-0.5 shrink-0 text-[10px] uppercase tracking-[0.1em] text-phosphor">
            Agent
          </span>
          <p className="text-[13.5px] leading-relaxed text-ink-2">{prose(step.text)}</p>
        </div>
      );

    case 'chain':
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
});

/**
 * Shell for the in-progress step. The rAF loop writes into `hostRef` every
 * frame; React does not re-render as characters arrive.
 */
function StreamingShell({
  step,
  hostRef,
}: {
  step: DemoStep;
  hostRef: React.MutableRefObject<HTMLElement | null>;
}) {
  const setHost = (node: HTMLElement | null) => {
    hostRef.current = node;
  };

  switch (step.kind) {
    case 'user':
      return (
        <div className="flex gap-3">
          <span className="mono mt-0.5 shrink-0 text-[10px] uppercase tracking-[0.1em] text-ink-4">You</span>
          <p className="text-[13.5px] leading-relaxed text-ink">
            <span ref={setHost} />
            <span className="ml-px inline-block w-[7px] animate-pulse text-phosphor">▌</span>
          </p>
        </div>
      );

    case 'assistant':
      return (
        <div className="flex gap-3">
          <span className="mono mt-0.5 shrink-0 text-[10px] uppercase tracking-[0.1em] text-phosphor">
            Agent
          </span>
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            <span ref={setHost} />
            <span className="ml-px inline-block w-[7px] animate-pulse text-phosphor">▌</span>
          </p>
        </div>
      );

    case 'result':
      return (
        <div className="rounded-lg border border-phosphor/20 bg-scope-0/70">
          <div className="mono flex items-center gap-2 border-b border-grat-soft px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] text-ink-4">
            <CornerDownRight className="h-3 w-3 text-phosphor" />
            {step.meta}
          </div>
          <pre className="mono overflow-x-auto px-3 py-2 text-[11.5px] leading-[1.65] text-phosphor whitespace-pre-wrap">
            <span ref={setHost} />
            <span className="animate-pulse">▌</span>
          </pre>
        </div>
      );

    case 'file':
      return (
        <div className="rounded-lg border border-amber/25 bg-scope-0/70">
          <div className="mono flex items-center gap-2 border-b border-grat-soft px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] text-ink-4">
            <FileCode2 className="h-3 w-3 text-amber" />
            wrote {step.name}
          </div>
          <pre className="mono overflow-x-auto px-3 py-2 text-[11.5px] leading-[1.65] text-ink-3 whitespace-pre-wrap">
            <span ref={setHost} />
            <span className="animate-pulse text-amber">▌</span>
          </pre>
        </div>
      );

    case 'call':
    case 'chain':
      // Dwell-only steps: reuse the finished chrome with a running indicator.
      return <StepView step={step} complete={false} />;
  }
}

/* ── the console ───────────────────────────────────────────────────────── */

function Session({
  tab,
  playing,
  onToggle,
}: {
  tab: DemoTab;
  playing: boolean;
  onToggle: () => void;
}) {
  const { committed, streaming, hostRef, done, started, replay } = useTranscript(tab.steps, playing);
  const scroller = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const slack = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (slack < 140) node.scrollTop = node.scrollHeight;
    // Re-check often while streaming — host text grows without React commits.
    if (!playing || done) return;
    const id = window.setInterval(() => {
      const n = scroller.current;
      if (!n) return;
      const s = n.scrollHeight - n.scrollTop - n.clientHeight;
      if (s < 140) n.scrollTop = n.scrollHeight;
    }, 100);
    return () => clearInterval(id);
  }, [committed, playing, done]);

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
          <>
            {tab.steps.slice(0, committed).map((step, i) => (
              <StepView key={i} step={step} />
            ))}
            {streaming ? <StreamingShell key={committed} step={streaming} hostRef={hostRef} /> : null}
          </>
        )}
      </div>

      <div className="mono flex items-center gap-3 border-t border-grat bg-scope-1 px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-ink-4">
        <span className="hidden sm:inline">compact · ~{fmtTokens(PUBLISHED_SAVINGS.compactAvgSavedVsDiy)} DIY tokens saved / lookup</span>
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
    title: 'Radar researches, you code',
    body: `ask_radar and compact specialists return a brief plus next calls. Your model does not fetch four tools and re-read the evidence — typical compact lookup: ~${PUBLISHED_SAVINGS.compactAvgReturned} tokens in, ~${fmtTokens(PUBLISHED_SAVINGS.compactAvgSavedVsDiy)} DIY tokens kept out of context.`,
  },
  {
    title: 'No API keys',
    body: 'Streamable HTTP with OAuth 2.1. Point your client at the URL, approve the scopes you want — read, plans, batches — and the connection is live.',
  },
  {
    title: 'A receipt, not a token bill',
    body: 'Every structured reply carries economy: tokens returned, saved vs a full dump, saved vs DIY research. Compact reads stay free. Plans, debates, and asks are the paid artifacts.',
  },
];

export function McpDemo() {
  const [playing, setPlaying] = React.useState(false);
  const [active, setActive] = React.useState(DEMO_TABS[0].id);
  const stageRef = React.useRef<HTMLDivElement>(null);

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
          Same tools your client will call — compact by default, with a savings receipt. Prefer ask_radar over four
          fetches; a typical lookup keeps ~{fmtTokens(PUBLISHED_SAVINGS.compactAvgSavedVsDiy)} DIY tokens out of your
          context.
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
                  {/* Only the active tab streams — inactive panels unmount under
                      Radix Presence, but gating `playing` keeps a stray mount
                      from spinning a second rAF loop against the hero. */}
                  <Session tab={t} playing={playing && active === t.id} onToggle={toggle} />
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
