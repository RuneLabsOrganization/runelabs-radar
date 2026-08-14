'use client';

import * as React from 'react';
import { useMemo, useRef, useState, useEffect } from 'react';
import { hierarchy, treemap as d3treemap, type HierarchyRectangularNode } from 'd3-hierarchy';
import { DOMAIN_COLORS, DOMAIN_LABELS, isDomain, type Domain } from '@/lib/domains';
import { fmtMoney } from '@/lib/opportunities/sizing';
import { OPTICS, opticById } from '@/lib/opportunities/optics';
import type { OppView } from './OppDossier';

type Sector = Domain | 'general';

interface TileDatum {
  opp: OppView;
  area: number;
  demandOnly: boolean;
  score: number;
  sector: Sector;
}

interface GroupNode {
  name?: string;
  children?: GroupNode[];
  tile?: TileDatum;
  value?: number;
}

const SECTOR_ORDER: Sector[] = ['coding', 'agentic', 'video', 'image', 'copy', 'ads', 'general'];

function sectorColor(sector: Sector): string {
  return sector === 'general' ? 'var(--ink-4)' : DOMAIN_COLORS[sector];
}

function sectorLabel(sector: Sector): string {
  return sector === 'general' ? 'GENERAL' : DOMAIN_LABELS[sector].toUpperCase();
}

/**
 * The opportunity map: the field viewed through switchable lenses ("optics") —
 * each optic pairs an AREA metric with a COLOR metric and prints its formula
 * verbatim below the chart. AREA never silently means "best": the caption says
 * exactly what it means in each lens. Hatched tiles = missing KPI data
 * (demand-only sizing). Fluid: layout recomputed from measured width.
 */
export default function OpportunityMap({ opps, sortKey }: { opps: OppView[]; sortKey: 'flip' | 'hold' }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [opticId, setOpticId] = useState('flip');
  const [hover, setHover] = useState<{ x: number; y: number; tile: TileDatum } | null>(null);
  const optic = opticById(opticId);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const height = width > 0 && width < 640 ? 560 : 420;

  const tiles = useMemo(() => {
    const out: TileDatum[] = [];
    for (const o of opps) {
      const area = optic.areaOf(o.kpis, o.sub);
      const demandOnly = area === null;
      const effectiveArea = demandOnly ? (o.sub.demand ?? 0) : area!;
      if (effectiveArea <= 0) continue;
      out.push({
        opp: o,
        area: effectiveArea,
        demandOnly,
        score: optic.colorOf(o, sortKey),
        sector: o.sector && isDomain(o.sector) ? o.sector : 'general',
      });
    }
    return out;
  }, [opps, sortKey, optic]);

  const groups = useMemo(() => {
    const by = new Map<Sector, TileDatum[]>();
    for (const t of tiles) {
      const list = by.get(t.sector) ?? [];
      list.push(t);
      by.set(t.sector, list);
    }
    return SECTOR_ORDER.filter((s) => by.has(s)).map((s) => ({
      sector: s,
      tiles: by.get(s)!,
      n: by.get(s)!.length,
    }));
  }, [tiles]);

  const layout = useMemo(() => {
    if (width === 0 || groups.length === 0) return null;
    const root: GroupNode = {
      children: groups.map((g) => ({
        name: sectorLabel(g.sector),
        children: g.tiles.map((tile) => ({ tile, value: tile.area })),
      })),
    };
    return d3treemap<GroupNode>()
      .size([width, height])
      .paddingOuter(3)
      .paddingInner(2)
      .paddingTop(16)(
      hierarchy(root)
        .sum((d) => d.value ?? 0)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    );
  }, [width, height, groups]);

  const groupNodes = layout?.children ?? [];
  const leaves = layout?.leaves() ?? [];

  return (
    <div className="mb-6">
      {/* the lenses */}
      <div className="mono mb-2 flex flex-wrap items-center gap-1.5 text-[10px] tracking-[0.06em]">
        <span style={{ color: 'var(--ink-4)' }}>lens</span>
        {OPTICS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setOpticId(o.id)}
            aria-pressed={opticId === o.id}
            className={`cursor-pointer rounded-[3px] border px-2 py-0.5 uppercase transition-colors ${
              opticId === o.id
                ? 'border-[var(--phosphor)] text-[var(--ink)]'
                : 'border-[var(--grat)] text-[var(--ink-3)] hover:border-[var(--grat-strong)]'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div ref={wrapRef} className="relative rounded-[6px] border border-[var(--grat-soft)] bg-[var(--scope-1)]" style={{ height }}>
        {width > 0 && tiles.length === 0 && (
          <p className="mono absolute inset-x-4 top-4 text-[11px]" style={{ color: 'var(--ink-4)' }}>
            no openings carry the {optic.label} metric — switch lens.
          </p>
        )}
        {width > 0 &&
          groupNodes.map((g, gi) => (
            <span
              key={gi}
              className="mono absolute text-[10px] uppercase tracking-[0.08em]"
              style={{ left: g.x0 + 4, top: g.y0 + 3, color: 'var(--ink-3)', pointerEvents: 'none' }}
            >
              {g.data.name} &middot; n={g.children?.length ?? 0}
            </span>
          ))}
        {width > 0 &&
          leaves.map((leaf: HierarchyRectangularNode<GroupNode>) => {
            const t = leaf.data.tile!;
            const w = leaf.x1 - leaf.x0;
            const h = leaf.y1 - leaf.y0;
            const color = sectorColor(t.sector);
            const alpha = 0.16 + (t.score / 100) * 0.6;
            const showText = w >= 64 && h >= 34;
            return (
              <a
                key={t.opp.id}
                href={`/opportunities/${t.opp.id}`}
                className="absolute block overflow-hidden rounded-[2px] transition-opacity hover:opacity-90"
                style={{
                  left: leaf.x0,
                  top: leaf.y0,
                  width: w,
                  height: h,
                  background: t.demandOnly
                    ? `repeating-linear-gradient(45deg, transparent, transparent 3px, var(--hatch) 3px, var(--hatch) 4px)`
                    : 'transparent',
                  border: `1px solid ${color}`,
                }}
                onMouseEnter={(e) => {
                  const rect = wrapRef.current!.getBoundingClientRect();
                  setHover({
                    x: Math.min(e.clientX - rect.left, Math.max(0, rect.width - 250)),
                    y: e.clientY - rect.top,
                    tile: t,
                  });
                }}
                onMouseLeave={() => setHover(null)}
              >
                <span aria-hidden className="absolute inset-0" style={{ background: color, opacity: t.demandOnly ? 0 : alpha }} />
                {showText && (
                  <span className="absolute inset-x-1.5 top-1 block">
                    <span className="block truncate text-[11px] leading-tight" style={{ color: 'var(--ink)' }}>
                      {t.opp.title}
                    </span>
                    <span className="mono mt-0.5 block text-[10px]" style={{ color: 'var(--ink-3)' }}>
                      {optic.colorLabel} {t.score}
                    </span>
                  </span>
                )}
              </a>
            );
          })}
        {hover && (
          <div
            className="mono pointer-events-none absolute z-10 max-w-[250px] rounded-[4px] border px-2.5 py-1.5 text-[10.5px]"
            style={{
              left: hover.x + 12,
              top: Math.max(4, hover.y - 12),
              background: 'var(--scope-2)',
              borderColor: 'var(--grat)',
              color: 'var(--ink-2)',
            }}
          >
            <div style={{ color: 'var(--ink)' }}>{hover.tile.opp.title}</div>
            <div style={{ color: 'var(--ink-4)' }}>
              {sectorLabel(hover.tile.sector).toLowerCase()} &middot; flip {hover.tile.opp.flipScore} &middot; hold {hover.tile.opp.holdScore}
              {hover.tile.opp.kpis?.priceUsd != null && ` · $${hover.tile.opp.kpis.priceUsd}/mo`}
              {hover.tile.opp.kpis?.initialCostUsd != null && ` · cost ${fmtMoney(hover.tile.opp.kpis.initialCostUsd)}`}
              {hover.tile.opp.kpis?.timeToMvpDays != null && ` · mvp ~${Math.round(hover.tile.opp.kpis.timeToMvpDays)}d`}
              {hover.tile.demandOnly ? ' · demand-only' : ''}
            </div>
          </div>
        )}
      </div>
      <p className="mono mt-1.5 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        {optic.caption} &middot; hatched = no KPI data &middot; click tile for the dossier
      </p>
    </div>
  );
}
