'use client';

import * as React from 'react';
import { useMemo, useState } from 'react';
import { paretoFrontier, type AaModel } from '@/lib/pareto';
import { fmtUsd, taskCost, TASK_ARCHETYPES } from '@/lib/costs';

const CHART_SIZE = 14;

/**
 * The bottom line: what one concrete piece of Runelabs work costs on each
 * model. Task chips switch the token archetype; assumptions stay visible.
 */
export default function TaskCostExplorer({ models }: { models: AaModel[] }) {
  const [taskKey, setTaskKey] = useState(TASK_ARCHETYPES[0].key);
  const task = TASK_ARCHETYPES.find((t) => t.key === taskKey) ?? TASK_ARCHETYPES[0];

  // Chart set: pareto-frontier models plus the most intelligent rest, so both
  // the value picks and the flagships are always on the board.
  const chartSet = useMemo(() => {
    const priced = models.filter((m) => m.priceIn !== null && m.priceOut !== null);
    const frontier = paretoFrontier(priced.map((m) => ({ x: m.price, y: m.intelligence })));
    const picked: AaModel[] = priced.filter((_, i) => frontier[i]);
    for (const m of priced) {
      if (picked.length >= CHART_SIZE) break;
      if (!picked.includes(m)) picked.push(m); // models arrive intelligence-sorted
    }
    return { picked: picked.slice(0, CHART_SIZE), frontierSet: new Set(priced.filter((_, i) => frontier[i])) };
  }, [models]);

  const rows = useMemo(() => {
    return chartSet.picked
      .map((m) => ({ m, cost: taskCost(m, task) }))
      .filter((r): r is { m: AaModel; cost: number } => r.cost !== null)
      .sort((a, b) => a.cost - b.cost);
  }, [chartSet, task]);

  if (rows.length === 0) return null;
  const maxCost = rows[rows.length - 1].cost;
  const cheapest = rows[0];
  const priciest = rows[rows.length - 1];
  const spread = cheapest.cost > 0 ? Math.round(priciest.cost / cheapest.cost) : null;

  return (
    <div>
      <div className="mono mb-2 flex flex-wrap items-center gap-1.5 text-[10px] tracking-[0.06em]">
        {TASK_ARCHETYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTaskKey(t.key)}
            aria-pressed={t.key === taskKey}
            className={`cursor-pointer rounded-[3px] border px-2 py-0.5 uppercase transition-colors ${
              t.key === taskKey
                ? 'border-[var(--phosphor)] text-[var(--ink)]'
                : 'border-[var(--grat)] text-[var(--ink-3)] hover:border-[var(--grat-strong)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mono mb-3 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        {task.blurb} &middot; assumes ~{(task.inTokens / 1000).toLocaleString()}k in /{' '}
        {(task.outTokens / 1000).toLocaleString()}k out tokens
        {spread !== null && spread > 1 && (
          <span style={{ color: 'var(--ink-3)' }}>
            {' '}
            &middot; priciest is {spread}&times; the cheapest
          </span>
        )}
      </p>
      <ul className="flex flex-col gap-[7px]">
        {rows.map(({ m, cost }) => {
          const onFrontier = chartSet.frontierSet.has(m);
          return (
            <li key={m.name} title={`${m.name} — in $${m.priceIn}/1M, out $${m.priceOut}/1M`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="mono min-w-0 truncate text-[11px]" style={{ color: 'var(--ink-2)' }}>
                  {m.name}
                  {m.org && (
                    <span style={{ color: 'var(--ink-4)' }}> &middot; {m.org}</span>
                  )}
                </span>
                <span className="mono shrink-0 text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
                  <span style={{ color: 'var(--ink-4)' }}>intel {m.intelligence}</span>
                  <span className="ml-2" style={{ color: onFrontier ? 'var(--phosphor)' : 'var(--ink-2)' }}>
                    {fmtUsd(cost)}
                  </span>
                </span>
              </div>
              <div className="mt-[3px] h-[3px] w-full rounded-[1px]" style={{ background: 'var(--grat-soft)' }}>
                <div
                  key={taskKey}
                  className="anim-bar h-full rounded-[1px]"
                  style={{
                    width: `${Math.max(1.5, (cost / maxCost) * 100)}%`,
                    background: onFrontier ? 'var(--phosphor)' : 'var(--grat-strong)',
                    opacity: onFrontier ? 0.8 : 0.9,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mono mt-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
        <span aria-hidden style={{ color: 'var(--phosphor)' }}>&#9679;</span> pareto-frontier model &middot;
        token budgets are stated assumptions — tune in src/lib/costs.ts
      </p>
    </div>
  );
}
