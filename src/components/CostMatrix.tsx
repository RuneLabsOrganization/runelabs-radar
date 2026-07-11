// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import { fmtUsd, taskCost, TASK_ARCHETYPES } from '@/lib/costs';
import { paretoFrontier, type AaModel } from '@/lib/pareto';

const ROW_CAP = 9;

/**
 * Models × tasks cost heatmap. Shading is a single-hue sequential ramp of
 * log-cost *within each task column* (columns span different magnitudes);
 * the phosphor cell is the cheapest model for that task.
 */
export default function CostMatrix({ models }: { models: AaModel[] }) {
  const priced = models.filter((m) => m.priceIn !== null && m.priceOut !== null);
  const frontier = paretoFrontier(priced.map((m) => ({ x: m.price, y: m.intelligence })));
  const rows: AaModel[] = priced.filter((_, i) => frontier[i]);
  for (const m of priced) {
    if (rows.length >= ROW_CAP) break;
    if (!rows.includes(m)) rows.push(m);
  }
  const picked = rows.slice(0, ROW_CAP).sort((a, b) => b.intelligence - a.intelligence);
  if (picked.length === 0) return null;

  // per-column log-normalized shading + winner
  const cols = TASK_ARCHETYPES.map((t) => {
    const costs = picked.map((m) => taskCost(m, t)!);
    const min = Math.min(...costs);
    const max = Math.max(...costs);
    const logSpan = Math.max(1e-9, Math.log10(max) - Math.log10(min));
    return { t, costs, min, norm: (c: number) => (Math.log10(c) - Math.log10(min)) / logSpan };
  });

  return (
    <div className="overflow-x-auto">
      <table className="table" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            <th>Model</th>
            {TASK_ARCHETYPES.map((t) => (
              <th key={t.key} className="text-right" title={t.blurb}>
                {t.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {picked.map((m, ri) => (
            <tr key={m.name}>
              <td className="mono text-[11px]" style={{ color: 'var(--ink-2)' }}>
                {m.name}
                <span className="ml-1.5" style={{ color: 'var(--ink-4)' }}>
                  {m.intelligence}
                </span>
              </td>
              {cols.map(({ t, costs, min, norm }) => {
                const c = costs[ri];
                const winner = c === min;
                return (
                  <td
                    key={t.key}
                    className="mono text-right text-[11px]"
                    title={`${m.name} · ${t.label}: ${fmtUsd(c)} (${t.inTokens / 1000}k in / ${t.outTokens / 1000}k out)`}
                    style={{
                      background: `rgba(151, 180, 205, ${0.03 + norm(c) * 0.16})`,
                      color: winner ? 'var(--phosphor)' : 'var(--ink-2)',
                    }}
                  >
                    {winner && <span aria-label="cheapest for this task">&#9646;&nbsp;</span>}
                    {fmtUsd(c)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mono mt-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        shading = relative cost within each task column (log scale) &middot;{' '}
        <span style={{ color: 'var(--phosphor)' }}>&#9646;</span> cheapest for the task &middot; number
        beside model = intelligence index
      </p>
    </div>
  );
}
