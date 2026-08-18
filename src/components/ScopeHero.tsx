'use client';

// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DOMAINS, DOMAIN_LABELS, type Domain } from '@/lib/domains';
import { blipPosition, easeOutExpo, kpiFormat } from '@/lib/scope';
import MiniTrend from './MiniTrend';

export interface ScopeBlip {
  id: number;
  title: string;
  domain: Domain | null;
  score: number;
  isNew: boolean;
}

export interface ScopeKpi {
  label: string;
  value: number;
  series?: number[] | null;
}

export interface ScopeInsight {
  headline: string;
  detail: string;
  direction: 'up' | 'down' | 'watch';
  /** where the slide leads when clicked (entity / domain page) */
  href?: string;
}

const TWO_PI = Math.PI * 2;
const DIRECTION_GLYPH = { up: '▲', down: '▼', watch: '◆' } as const;
const DIRECTION_COLOR = { up: 'var(--phosphor)', down: 'var(--alert)', watch: 'var(--amber)' } as const;

/** KPI numeral that tweens 0 → value on mount (final value instantly under reduced motion). */
function Counter({ value }: { value: number }) {
  const [display, setDisplay] = React.useState(value);
  React.useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setDisplay(0);
    const t0 = performance.now();
    const D = 900;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / D);
      setDisplay(Math.round(value * easeOutExpo(t)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span className="mono text-[30px] font-light leading-none tracking-[-0.02em]" style={{ color: 'var(--ink)' }}>
      {kpiFormat(display)}
    </span>
  );
}

function readCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * The scope: today's stories plotted as sweep-lit contacts on a radar —
 * angle = sector, radius = score. Canvas 2D (no WebGL on the critical path),
 * brightness per blip = exp decay behind the rotating beam (the RadarField
 * shader formula). Hover → tooltip, click → story. Static frame under
 * prefers-reduced-motion; RAF paused when the tab is hidden.
 */
export default function ScopeHero({
  blips,
  kpis,
  insights,
}: {
  blips: ScopeBlip[];
  kpis: ScopeKpi[];
  insights: ScopeInsight[];
}) {
  const router = useRouter();
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = React.useState<{ x: number; y: number; blip: ScopeBlip } | null>(null);
  const [insightIdx, setInsightIdx] = React.useState(0);
  const [insightPaused, setInsightPaused] = React.useState(false);
  // bumped by ThemeToggle's 'radar:theme' broadcast — re-runs the canvas
  // effect so scope colors are re-read from the flipped CSS tokens
  const [themeTick, setThemeTick] = React.useState(0);
  React.useEffect(() => {
    const on = () => setThemeTick((t) => t + 1);
    window.addEventListener('radar:theme', on);
    return () => window.removeEventListener('radar:theme', on);
  }, []);

  // insight rotation: calm 8s cadence — paused on hover/focus, off under
  // reduced motion; arrows + dots always allow manual paging
  React.useEffect(() => {
    if (insights.length < 2 || insightPaused) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setInsightIdx((i) => (i + 1) % insights.length), 8000);
    return () => clearInterval(id);
  }, [insights.length, insightPaused]);

  React.useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const colors = {
      phosphor: readCssVar('--phosphor') || '#57d9a3',
      gratSoft: readCssVar('--grat-soft') || 'rgba(151,180,205,0.12)',
      grat: readCssVar('--grat') || 'rgba(151,180,205,0.22)',
      ink4: readCssVar('--ink-4') || '#5b6b7d',
      sectors: DOMAINS.map((d) => readCssVar(`--d-${d}`) || readCssVar(`--sector-${d}`) || '#57d9a3'),
    };

    const placed = blips.map((b) => ({ b, ...blipPosition(b.domain, b.score, b.id) }));
    const topIds = new Set(
      [...new Map(blips.map((b) => [b.id, b])).values()]
        .sort((a, b2) => b2.score - a.score)
        .slice(0, 3)
        .map((b) => b.id),
    );

    let width = 0;
    let height = 0;
    let dpr = 1;
    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w === 0 || h === 0) return;
      const nextDpr = Math.min(window.devicePixelRatio || 1, 1.5);
      // touching canvas.width/height wipes the backing store — only resize on
      // real change (the next RAF frame repaints immediately after)
      if (w === width && h === height && nextDpr === dpr) return;
      width = w;
      height = h;
      dpr = nextDpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    /** canvas px position of a placed blip */
    const px = (p: { angle: number; r: number }) => {
      const cx = width / 2;
      const cy = height / 2;
      const R = Math.min(width, height) / 2 - 26;
      // canvas angle 0 = 3 o'clock; start first wedge at 12 o'clock
      const a = p.angle - Math.PI / 2;
      return { x: cx + Math.cos(a) * p.r * R, y: cy + Math.sin(a) * p.r * R };
    };

    const draw = (sweepAngle: number, t: number) => {
      if (width === 0 || height === 0) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      const R = Math.min(width, height) / 2 - 26;
      const wedge = TWO_PI / DOMAINS.length;

      // sector wedge tints
      for (let i = 0; i < DOMAINS.length; i++) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, i * wedge - Math.PI / 2, (i + 1) * wedge - Math.PI / 2);
        ctx.closePath();
        ctx.globalAlpha = 0.045;
        ctx.fillStyle = colors.sectors[i];
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // graticule: rings + spokes
      ctx.strokeStyle = colors.gratSoft;
      ctx.lineWidth = 1;
      for (let ring = 1; ring <= 4; ring++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (R * ring) / 4, 0, TWO_PI);
        ctx.stroke();
      }
      for (let s = 0; s < 12; s++) {
        const a = (s / 12) * TWO_PI;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.stroke();
      }

      // wedge labels on the rim
      ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = colors.ink4;
      for (let i = 0; i < DOMAINS.length; i++) {
        const a = (i + 0.5) * wedge - Math.PI / 2;
        const lx = cx + Math.cos(a) * (R + 13);
        const ly = cy + Math.sin(a) * (R + 13);
        ctx.fillText(DOMAIN_LABELS[DOMAINS[i]].toUpperCase(), lx, ly);
      }

      // sweep: trailing wedge of thin slices + leading edge line
      for (let s = 0; s < 34; s++) {
        const frac = s / 34;
        const a0 = sweepAngle - 1.0 * (1 - frac) - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a0 + 0.03);
        ctx.closePath();
        ctx.globalAlpha = 0.22 * frac * frac;
        ctx.fillStyle = colors.phosphor;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.phosphor;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sweepAngle - Math.PI / 2) * R, cy + Math.sin(sweepAngle - Math.PI / 2) * R);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // blips: brighten as the beam passes, then decay; new contacts pulse
      // (pulse is the flashy bit — it stays behind the reduced-motion gate)
      for (const p of placed) {
        const d = ((sweepAngle - p.angle) % TWO_PI + TWO_PI) % TWO_PI;
        let bright = 0.26 + Math.exp(-d * 2.6) * 0.95;
        if (p.b.isNew && !reduced) bright *= 0.82 + 0.18 * Math.sin(t * 2.4 + p.b.id);
        bright = Math.min(1, bright);
        const { x, y } = px(p);
        const rPx = 2.4 + (p.b.score / 100) * 3;

        const glow = ctx.createRadialGradient(x, y, 0, x, y, rPx * 4.5);
        glow.addColorStop(0, colors.phosphor);
        glow.addColorStop(1, 'transparent');
        ctx.globalAlpha = bright * 0.28;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, rPx * 4.5, 0, TWO_PI);
        ctx.fill();

        ctx.globalAlpha = bright;
        ctx.fillStyle = colors.phosphor;
        ctx.beginPath();
        ctx.arc(x, y, rPx, 0, TWO_PI);
        ctx.fill();

        if (topIds.has(p.b.id)) {
          ctx.globalAlpha = Math.max(0.35, bright);
          ctx.strokeStyle = colors.phosphor;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, rPx + 4.5, 0, TWO_PI);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    };

    let raf = 0;
    let sweepAngle = Math.random() * TWO_PI;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      sweepAngle = (sweepAngle + dt * 0.75) % TWO_PI;
      draw(sweepAngle, now / 1000);
    };
    const loop = (now: number) => {
      // a single bad frame must never kill the sweep — reschedule first
      raf = requestAnimationFrame(loop);
      try {
        frame(now);
      } catch (e) {
        console.error('[scope] frame failed:', e);
      }
    };
    // The sweep is slow ambient motion (a revolution every ~8s, like a clock
    // hand) — it runs even under prefers-reduced-motion; only the new-contact
    // pulse, counters, draw-ins and staggers are gated by it.
    raf = requestAnimationFrame(loop);

    const onVisibility = () => {
      if (reduced) return;
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // hover / click hit-testing (nearest blip within 14px)
    const pick = (e: MouseEvent): { x: number; y: number; blip: ScopeBlip } | null => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let best: { x: number; y: number; blip: ScopeBlip; dist: number } | null = null;
      for (const p of placed) {
        const { x, y } = px(p);
        const dist = Math.hypot(mx - x, my - y);
        if (dist < 14 && (!best || dist < best.dist)) best = { x, y, blip: p.b, dist };
      }
      return best ? { x: best.x, y: best.y, blip: best.blip } : null;
    };
    const onMove = (e: MouseEvent) => {
      const hit = pick(e);
      setHover(hit);
      canvas.style.cursor = hit ? 'pointer' : 'default';
    };
    const onLeave = () => setHover(null);
    const onClick = (e: MouseEvent) => {
      const hit = pick(e);
      if (hit) router.push(`/story/${hit.blip.id}`);
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('click', onClick);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('click', onClick);
      ro.disconnect();
    };
  }, [blips, router, themeTick]);

  const insight = insights.length > 0 ? insights[insightIdx % insights.length] : null;

  return (
    <section aria-label="Today at a glance" className="grid gap-5 md:grid-cols-[1.25fr_1fr]">
      {/* the scope */}
      <div
        ref={wrapRef}
        className="relative h-[260px] overflow-hidden rounded-[6px] border border-[var(--grat-soft)] bg-[var(--scope-1)] md:h-[340px]"
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Radar scope: ${blips.length} stories plotted — angle is sector, distance from center is relevance`}
        />
        {hover && (
          <div
            className="mono pointer-events-none absolute z-10 max-w-[240px] rounded-[4px] border px-2.5 py-1.5 text-[10.5px]"
            style={{
              left: Math.min(hover.x + 12, Math.max(0, (wrapRef.current?.clientWidth ?? 300) - 250)),
              top: Math.max(4, hover.y - 30),
              background: 'var(--scope-2)',
              borderColor: 'var(--grat)',
              color: 'var(--ink-2)',
            }}
          >
            <span style={{ color: 'var(--ink)' }}>{hover.blip.title}</span>
            <br />
            <span style={{ color: 'var(--ink-4)' }}>
              score {hover.blip.score}
              {hover.blip.domain ? ` · ${DOMAIN_LABELS[hover.blip.domain]}` : ''} · click to read
            </span>
          </div>
        )}
        {/* a11y: the blips as a plain list (deduped — a story can sit in several wedges) */}
        <ul className="sr-only">
          {[...new Map(blips.map((b) => [b.id, b])).values()].map((b) => (
            <li key={b.id}>
              <a href={`/story/${b.id}`}>{b.title}</a>
            </li>
          ))}
        </ul>
      </div>

      {/* the rail: counters + rotating smart insight */}
      <div className="flex min-w-0 flex-col gap-5">
        <div className="grid grid-cols-3 gap-3">
          {kpis.map((k) => (
            <div key={k.label}>
              <Counter value={k.value} />
              <div className="mono mt-1.5 text-[10px] uppercase leading-snug tracking-[0.08em]" style={{ color: 'var(--ink-4)' }}>
                {k.label}
              </div>
              {k.series && (
                <div className="mt-2 max-w-[104px]">
                  <MiniTrend values={k.series} height={20} fluid />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* the insight carousel: auto-rotates, pauses on hover/focus, always
            manually pageable; explains itself when the brief hasn't run */}
        <div
          className="rounded-[6px] border border-[var(--grat-soft)] bg-[var(--scope-1)] p-4"
          onMouseEnter={() => setInsightPaused(true)}
          onMouseLeave={() => setInsightPaused(false)}
          onFocus={() => setInsightPaused(true)}
          onBlur={() => setInsightPaused(false)}
        >
          <div className="readout mb-2 flex items-center justify-between">
            <span style={{ color: 'var(--phosphor)' }}>smart insight</span>
            {insights.length > 1 && (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  className="vote-btn"
                  aria-label="previous insight"
                  onClick={() => setInsightIdx((i) => (i - 1 + insights.length) % insights.length)}
                >
                  &#8249;
                </button>
                {insights.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className="vote-btn"
                    aria-label={`insight ${i + 1} of ${insights.length}`}
                    aria-pressed={i === insightIdx}
                    onClick={() => setInsightIdx(i)}
                  >
                    <span
                      aria-hidden
                      className="inline-block h-[3px] w-[3px] rounded-full align-middle"
                      style={{ background: i === insightIdx ? 'var(--phosphor)' : 'var(--grat-strong)' }}
                    />
                  </button>
                ))}
                <button
                  type="button"
                  className="vote-btn"
                  aria-label="next insight"
                  onClick={() => setInsightIdx((i) => (i + 1) % insights.length)}
                >
                  &#8250;
                </button>
              </span>
            )}
          </div>
          {insight ? (
            <div key={insightIdx} className="scope-insight" aria-live="polite">
              <div className="flex items-baseline gap-2">
                <span
                  className="mono text-[11px]"
                  style={{ color: DIRECTION_COLOR[insight.direction] }}
                  aria-hidden
                >
                  {DIRECTION_GLYPH[insight.direction]}
                </span>
                <span className="text-[13.5px] font-semibold leading-snug" style={{ color: 'var(--ink)' }}>
                  {insight.href ? (
                    <Link
                      href={insight.href}
                      className="decoration-[var(--grat-strong)] underline-offset-2 hover:underline"
                    >
                      {insight.headline}
                    </Link>
                  ) : (
                    insight.headline
                  )}
                </span>
              </div>
              {insight.detail && (
                <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
                  {insight.detail}
                </p>
              )}
            </div>
          ) : (
            <p className="mono text-[10.5px] leading-relaxed" style={{ color: 'var(--ink-4)' }}>
              analyst notes land after the 07:00 brief
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
