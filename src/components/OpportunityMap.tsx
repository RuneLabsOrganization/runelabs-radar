'use client';

import * as React from 'react';
import { useMemo, useRef, useState, useEffect } from 'react';
import { hierarchy, treemap as d3treemap, type HierarchyRectangularNode } from 'd3-hierarchy';
import { DOMAIN_COLORS, DOMAIN_LABELS, isDomain, type Domain } from '@/lib/domains';
import { fmtMoney, oppSizeEstimate } from '@/lib/opportunities/sizing';
import type { OppView } from './OppDossier';

type Sector = Domain | 'general';

interface TileDatum {
  opp: OppView;
  usd: number;
  demandOnly: boolean;
  score: number;
  sector: Sector;
}

interface GroupNode {
  name?: string;
  label?: string;
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
 * The opportunity map: every opening as a tile — AREA = size estimate (USD/yr,
 * composite formula captioned below), COLOR = score, GROUP = sector. Fluid:
 * layout recomputed from measured width on resize. TAPE §02's encodings with
 * Radar's honesty contract. Hatched tiles = no KPI data (demand-only sizing).
 */
export default function OpportunityMap({ opps, sortKey }: { opps: OppView[]; sortKey: 'flip' | 'hold' }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ x: number; y: number; tile: TileDatum } | null>(null);

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
      const est = oppSizeEstimate(o.kpis, o.sub);
      if (est.usd <= 0) continue;
      out.push({
        opp: o,
        usd: est.usd,
        demandOnly: est.demandOnly,
        score: sortKey === 'flip' ? o.flipScore : o.holdScore,
        sector: o.sector && isDomain(o.sector) ? o.sector : 'general',
      });
    }
    return out;
  }, [opps, sortKey]);

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
      total: by.get(s)!.reduce((a, t) => a + t.usd, 0),
    }));
  }, [tiles]);

  const layout = useMemo(() => {
    if (width === 0 || groups.length === 0) return null;
    const root: GroupNode = {
      children: groups.map((g) => ({
        name: sectorLabel(g.sector),
        children: g.tiles.map((tile) => ({ tile, value: tile.usd })),
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

  if (tiles.length === 0) return null;

  return (
    <div className="mb-6">
      <div ref={wrapRef} className="relative rounded-[6px] border border-[var(--grat-soft)] bg-[var(--scope-1)]" style={{ height }}>
        {width > 0 &&
          groupNodes.map((g, gi) => (
            <span
              key={gi}
              className="mono absolute text-[10px] uppercase tracking-[0.08em]"
              style={{
                left: g.x0 + 4,
                top: g.y0 + 3,
                color: 'var(--ink-3)',
                pointerEvents: 'none',
              }}
            >
              {g.data.name} &middot; {fmtMoney(g.value ?? 0)} &middot; n={g.children?.length ?? 0}
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
                    ? `repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(151,180,205,0.10) 3px, rgba(151,180,205,0.10) 4px)`
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
                <span
                  aria-hidden
                  className="absolute inset-0"
                  style={{ background: color, opacity: t.demandOnly ? 0 : alpha }}
                />
                {showText && (
                  <span className="absolute inset-x-1.5 top-1 block">
                    <span className="block truncate text-[11px] leading-tight" style={{ color: 'var(--ink)' }}>
                      {t.opp.title}
                    </span>
                    <span className="mono mt-0.5 block text-[10px]" style={{ color: 'var(--ink-3)' }}>
                      {fmtMoney(t.usd)} &middot; {t.score}
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
              {sectorLabel(hover.tile.sector).toLowerCase()} &middot; {sortKey} {hover.tile.score} &middot; {fmtMoney(hover.tile.usd)}
              {hover.tile.demandOnly ? ' · demand-only' : ''}
              {hover.tile.opp.kpis?.priceUsd != null && ` · $${hover.tile.opp.kpis.priceUsd}/mo`}
              {hover.tile.opp.kpis?.breakEvenCustomers != null && ` · ${Math.round(hover.tile.opp.kpis.breakEvenCustomers)} cust`
              }
            </div>
          </div>
        )}
      </div>
      <p className="mono mt-1.5 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        size est = price/mo &times; 12 &times; break-even customers &times; (demand&divide;20) &middot; USD/yr
        estimate &middot; hatched = no KPI data &middot; click tile for the dossier
      </p>
    </div>
  );
}
