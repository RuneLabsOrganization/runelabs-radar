'use client';

import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { hierarchy, pack, type HierarchyCircularNode } from 'd3-hierarchy';
import { DOMAIN_COLORS, DOMAIN_LABELS } from '@/lib/domains';
import type { ClusterStory, TopicNode } from '@/lib/analytics';

const W = 960;
const H = 640;
const COMPACT_H = 400;

interface Datum {
  kind: 'root' | 'macro' | 'sub';
  node?: TopicNode;
  children?: Datum[];
  value?: number;
}

type PackNode = HierarchyCircularNode<Datum>;

interface View {
  x: number;
  y: number;
  /** diameter to fit into the viewport's short side — root uses the short side itself so k=1 */
  d: number;
}

interface StoryBubble {
  story: ClusterStory;
  x: number;
  y: number;
  r: number;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * The topic map as a zoomable circle-pack: macro categories → click to zoom
 * into subtopics → click a subtopic and its stories appear as bubbles that
 * open the news itself. Every level labeled, nothing overlaps.
 */
export default function BubbleMap({ data, compact = false }: { data: TopicNode[]; compact?: boolean }) {
  const height = compact ? COMPACT_H : H;

  const root = useMemo(() => {
    const tree: Datum = {
      kind: 'root',
      children: data.map((m) => ({
        kind: 'macro' as const,
        node: m,
        ...(m.children.length > 0
          ? { children: m.children.map((s) => ({ kind: 'sub' as const, node: s, value: s.size })) }
          : { value: m.size }),
      })),
    };
    return pack<Datum>()
      .size([W, height])
      .padding((d) => (d.depth === 0 ? 20 : 6))(
      hierarchy(tree).sum((d) => d.value ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    );
  }, [data, height]);

  const macros = useMemo(() => root.children ?? [], [root]);
  // root view must map 1:1 (k = 1) or the whole pack renders shrunken and
  // labels fall below their visibility threshold — the "tiny circles" bug
  const rootView = useMemo<View>(
    () => ({ x: W / 2, y: height / 2, d: Math.min(W, height) }),
    [height],
  );

  const [focus, setFocus] = useState<PackNode | null>(null); // null = root overview
  const [view, setView] = useState<View>(rootView);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [hoverCluster, setHoverCluster] = useState<{ node: TopicNode; x: number; y: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMounted(true);
      return;
    }
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const [stories, setStories] = useState<Map<number, ClusterStory[]>>(new Map());
  const [loadingLeaf, setLoadingLeaf] = useState<number | null>(null);
  const [storyError, setStoryError] = useState<string | null>(null);
  const [hoverStory, setHoverStory] = useState<{ s: ClusterStory; x: number; y: number } | null>(null);
  const animRef = useRef(0);

  const viewOf = (n: PackNode | null): View =>
    n === null ? rootView : { x: n.x, y: n.y, d: n.r * 2.12 };

  function animateTo(target: View) {
    cancelAnimationFrame(animRef.current);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setView(target);
      return;
    }
    const from = { ...viewRef.current };
    const t0 = performance.now();
    const D = 450;
    const step = (now: number) => {
      const t = easeInOut(Math.min(1, (now - t0) / D));
      setView({
        x: from.x + (target.x - from.x) * t,
        y: from.y + (target.y - from.y) * t,
        d: from.d + (target.d - from.d) * t,
      });
      if (t < 1) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
  }
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  const isLeaf = (n: PackNode) => !n.children || n.children.length === 0;

  function loadStories(leafId: number) {
    if (stories.has(leafId)) return;
    setLoadingLeaf(leafId);
    setStoryError(null);
    fetch(`/api/clusters/${leafId}/stories`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`(${res.status})`);
        const data = (await res.json()) as { stories?: ClusterStory[] };
        setStories((prev) => new Map(prev).set(leafId, data.stories ?? []));
      })
      .catch(() => setStoryError('failed to load stories — try again'))
      .finally(() => setLoadingLeaf((cur) => (cur === leafId ? null : cur)));
  }

  function focusNode(n: PackNode | null) {
    setFocus(n);
    setHoverStory(null);
    animateTo(viewOf(n));
    if (n && isLeaf(n) && n.data.node) loadStories(n.data.node.id);
  }

  function up() {
    if (!focus) return;
    const parent = focus.parent && focus.parent.data.kind !== 'root' ? focus.parent : null;
    focusNode(parent);
  }

  useEffect(() => {
    if (compact) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') up();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, compact]);

  // zoom transform — k is exactly 1 at the root overview
  const k = Math.min(W, height) / view.d;
  const sx = (x: number) => (x - view.x) * k + W / 2;
  const sy = (y: number) => (y - view.y) * k + height / 2;

  // story bubbles inside a focused leaf: a client-side mini-pack
  const storyBubbles = useMemo<StoryBubble[]>(() => {
    if (!focus || !isLeaf(focus) || !focus.data.node) return [];
    const list = stories.get(focus.data.node.id);
    if (!list || list.length === 0) return [];
    const mini = pack<{ story?: ClusterStory; children?: { story: ClusterStory; value: number }[] }>()
      .size([focus.r * 1.7, focus.r * 1.7])
      .padding(3)(
      hierarchy<{ story?: ClusterStory; children?: { story: ClusterStory; value: number }[] }>({
        children: list.map((s) => ({ story: s, value: s.score + 15 })),
      }).sum((d) => ('value' in d ? ((d as { value?: number }).value ?? 0) : 0)),
    );
    return (mini.children ?? []).map((c) => ({
      story: (c.data as { story: ClusterStory }).story,
      x: focus.x - focus.r * 0.85 + c.x,
      y: focus.y - focus.r * 0.85 + c.y,
      r: c.r,
    }));
  }, [focus, stories]);

  const focusedTopic = focus?.data.node ?? null;
  const parentTopic = focus?.parent?.data.node ?? null;

  const circleFill = (n: TopicNode) =>
    n.sector ? DOMAIN_COLORS[n.sector] : 'var(--phosphor)';

  const renderCluster = (n: PackNode, visible: boolean, labelVisible: boolean, delayIdx = 0) => {
    const t = n.data.node!;
    const r = n.r * k;
    if (!visible || r < 2) return null;
    const cx = sx(n.x);
    const cy = sy(n.y);
    const isFocus = focus === n;
    const hovered = hoverId === t.id;
    const fontSize = Math.max(9, Math.min(17, r * 0.16));
    const showLabel = labelVisible && r > 26;
    return (
      <g
        key={t.id}
        onClick={(e) => {
          e.stopPropagation();
          if (compact) return; // compact wraps in a Link instead
          if (isFocus) return;
          focusNode(n);
        }}
        onMouseEnter={(e) => {
          setHoverId(t.id);
          const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
          setHoverCluster({ node: t, x: (cx / W) * rect.width, y: (cy / height) * rect.height });
        }}
        onMouseLeave={() => {
          setHoverId(null);
          setHoverCluster(null);
        }}
        style={{ cursor: compact || isFocus ? 'default' : 'pointer' }}
      >
        <circle
          cx={cx}
          cy={cy}
          r={mounted ? (hovered && !isFocus ? r * 1.03 : r) : 0.001}
          fill={circleFill(t)}
          fillOpacity={isFocus ? 0.04 : hovered ? 0.16 : 0.08}
          stroke={circleFill(t)}
          strokeOpacity={0.18 + t.heat * 0.4 + (hovered ? 0.25 : 0)}
          strokeWidth={hovered || isFocus ? 1.5 : 1}
          style={{
            transition: `r 650ms cubic-bezier(0.22, 1, 0.36, 1) ${delayIdx * 45}ms, fill-opacity 150ms ease, stroke-opacity 150ms ease`,
          }}
        />
        {showLabel && (
          <>
            <text
              x={cx}
              y={cy - (n.children && !isFocus ? 0 : r * 0.02)}
              textAnchor="middle"
              fontSize={fontSize}
              fontFamily="var(--font-readout)"
              fill={hovered ? 'var(--ink)' : t.heat > 0.7 ? 'var(--ink)' : 'var(--ink-2)'}
              style={{
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                pointerEvents: 'none',
                opacity: mounted ? 1 : 0,
                transition: `opacity 500ms ease ${300 + delayIdx * 45}ms`,
              }}
            >
              {t.label.length > 26 ? `${t.label.slice(0, 25)}…` : t.label}
            </text>
            <text
              x={cx}
              y={cy + fontSize + 2}
              textAnchor="middle"
              fontSize={Math.max(8, fontSize * 0.7)}
              fontFamily="var(--font-readout)"
              fill="var(--ink-4)"
              style={{
                pointerEvents: 'none',
                opacity: mounted ? 1 : 0,
                transition: `opacity 500ms ease ${340 + delayIdx * 45}ms`,
              }}
            >
              {t.size} stories
            </text>
          </>
        )}
      </g>
    );
  };

  const svg = (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="block w-full select-none"
      role="img"
      aria-label="Topic map: zoomable categories down to individual stories"
      onClick={() => {
        if (!compact) up();
      }}
    >
      <rect x={0} y={0} width={W} height={height} fill="transparent" />

      {/* macros always give spatial context; labels only in the overview */}
      {macros.map((m, i) => renderCluster(m, true, focus === null, i))}

      {/* subs: shown when their macro is focused (labeled) or a sibling sub is focused */}
      {(focus && !isLeaf(focus)
        ? (focus.children ?? []).map((s) => ({ s, labeled: true }))
        : focus?.parent && focus.parent.data.kind === 'macro'
          ? (focus.parent.children ?? []).map((s) => ({ s, labeled: s !== focus }))
          : []
      ).map(({ s, labeled }, i) => renderCluster(s, true, labeled, i))}

      {/* stories inside the focused leaf */}
      {storyBubbles.map(({ story, x, y, r }) => {
        const rr = r * k;
        const cx = sx(x);
        const cy = sy(y);
        if (rr < 2) return null;
        const bubble = (
          <g
            key={story.id}
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={(e) => {
              const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
              setHoverStory({ s: story, x: ((cx / W) * rect.width), y: ((cy / height) * rect.height) });
            }}
            onMouseLeave={() => setHoverStory(null)}
            style={{ cursor: story.url ? 'pointer' : 'default' }}
          >
            <circle
              cx={cx}
              cy={cy}
              r={rr}
              fill="var(--phosphor)"
              fillOpacity={0.1 + (story.score / 100) * 0.25}
              stroke="var(--phosphor)"
              strokeOpacity={0.5}
            />
            {rr > 34 && (
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                fontSize={Math.max(8.5, Math.min(12, rr * 0.16))}
                fill="var(--ink-2)"
                style={{ pointerEvents: 'none' }}
              >
                {story.title.length > 24 ? `${story.title.slice(0, 23)}…` : story.title}
              </text>
            )}
          </g>
        );
        return story.url ? (
          <a key={story.id} href={story.url} target="_blank" rel="noreferrer">
            {bubble}
          </a>
        ) : (
          bubble
        );
      })}
    </svg>
  );

  const clusterTooltip = hoverCluster && (
    <div
      className="mono pointer-events-none absolute z-10 max-w-[300px] rounded-[4px] border px-2.5 py-1.5 text-[10.5px]"
      style={{
        left: Math.min(hoverCluster.x + 14, 640),
        top: hoverCluster.y + 12,
        background: 'var(--scope-2)',
        borderColor: 'var(--grat)',
        color: 'var(--ink-2)',
      }}
    >
      <div style={{ color: 'var(--ink)' }}>{hoverCluster.node.label}</div>
      {hoverCluster.node.summary && (
        <div style={{ color: 'var(--ink-3)' }}>{hoverCluster.node.summary}</div>
      )}
      <div style={{ color: 'var(--ink-4)' }}>
        {hoverCluster.node.size} stories &middot; heat {Math.round(hoverCluster.node.heat * 100)}%
        {hoverCluster.node.sector ? ` · ${DOMAIN_LABELS[hoverCluster.node.sector]}` : ''}
        {compact ? ' · click to explore' : ''}
      </div>
    </div>
  );

  if (compact) {
    return (
      <div className="relative">
        <Link href="/map" className="block" aria-label="Open the full topic map">
          {svg}
          <p className="mono mt-1.5 text-[10px]" style={{ color: 'var(--ink-4)' }}>
            {data.length} categories &middot; bubble = topic, size = volume, glow = heat &middot;
            click to zoom down to the stories
          </p>
        </Link>
        {clusterTooltip}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="mono mb-2 flex flex-wrap items-center gap-2 text-[10.5px] tracking-[0.08em] uppercase">
        <button
          type="button"
          onClick={() => focusNode(null)}
          className="cursor-pointer border-0 bg-transparent p-0"
          style={{ color: focus === null ? 'var(--ink)' : 'var(--ink-3)' }}
        >
          all topics
        </button>
        {parentTopic && (
          <>
            <span style={{ color: 'var(--ink-4)' }}>/</span>
            <button
              type="button"
              onClick={up}
              className="cursor-pointer border-0 bg-transparent p-0"
              style={{ color: 'var(--ink-3)' }}
            >
              {parentTopic.label}
            </button>
          </>
        )}
        {focusedTopic && (
          <>
            <span style={{ color: 'var(--ink-4)' }}>/</span>
            <span style={{ color: 'var(--phosphor)' }}>&#9646; {focusedTopic.label}</span>
            <span style={{ color: 'var(--ink-4)' }}>
              {focusedTopic.size} stories
              {focusedTopic.sector ? ` · ${DOMAIN_LABELS[focusedTopic.sector]}` : ''}
            </span>
          </>
        )}
        {loadingLeaf !== null && <span style={{ color: 'var(--phosphor)' }}>loading stories&hellip;</span>}
        {storyError && <span style={{ color: 'var(--alert)' }}>{storyError}</span>}
      </div>
      {focusedTopic?.summary && (
        <p className="mb-2 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
          {focusedTopic.summary}
        </p>
      )}

      <div className="rounded-[6px] border border-[var(--grat-soft)] bg-[var(--scope-1)]">{svg}</div>
      {clusterTooltip}

      {hoverStory && (
        <div
          className="mono pointer-events-none absolute z-10 max-w-[300px] rounded-[4px] border px-2.5 py-1.5 text-[10.5px]"
          style={{
            left: Math.min(hoverStory.x + 12, 700),
            top: hoverStory.y + 40,
            background: 'var(--scope-2)',
            borderColor: 'var(--grat)',
            color: 'var(--ink-2)',
          }}
        >
          <div style={{ color: 'var(--ink)' }}>{hoverStory.s.title}</div>
          <div style={{ color: 'var(--ink-3)' }}>
            signal {hoverStory.s.score} &middot; {hoverStory.s.ageDays}d ago
            {hoverStory.s.url ? ' · click to open' : ''}
          </div>
        </div>
      )}

      <p className="mono mt-1.5 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        click a category to zoom &middot; click a subtopic for its stories &middot; click a story to
        read it &middot; esc or background to zoom out
      </p>
    </div>
  );
}
