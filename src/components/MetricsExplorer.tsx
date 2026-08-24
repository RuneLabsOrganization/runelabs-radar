'use client';

import * as React from 'react';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { paths } from '@/lib/urls';

export interface MetricKey {
  source: string;
  entity: string;
  metric: string;
  latest: string;
  points: number;
}

export interface ExplorerSeries {
  source: string;
  entity: string;
  metric: string;
  points: { date: string; value: number }[];
}

export interface ExplorerPreset {
  id: string;
  label: string;
  keys: { source: string; entity: string; metric: string }[];
}

/** Allow launch-heat (8 categories) and a few overlays. */
export const MAX_SERIES = 8;
export const DAY_OPTIONS = [30, 90, 180, 365];

/**
 * Series identity in the URL: `s=enc(source):enc(entity):enc(metric)`
 * (encodeURIComponent escapes ':' inside parts, so the split is safe).
 * Duplicated in the metrics page — a server component can't import plain
 * functions from this client module.
 */
export function encodeKey(k: { source: string; entity: string; metric: string }): string {
  return [k.source, k.entity, k.metric].map(encodeURIComponent).join(':');
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Picker bar for Pulse explorer: source → entity → metric selects, preset
 * chips, active-series chips, range select, CSV export. Selection lives in
 * the URL (`?s=…&s=…&days=…`) so views are shareable.
 */
export default function MetricsExplorer({
  keys,
  active,
  days,
  series,
  presets = [],
}: {
  keys: MetricKey[];
  active: { source: string; entity: string; metric: string }[];
  days: number;
  series: ExplorerSeries[];
  presets?: ExplorerPreset[];
}) {
  const router = useRouter();
  const [source, setSource] = useState('');
  const [entity, setEntity] = useState('');
  const [metric, setMetric] = useState('');

  const sources = useMemo(() => [...new Set(keys.map((k) => k.source))].sort(), [keys]);
  const entities = useMemo(
    () => [...new Set(keys.filter((k) => k.source === source).map((k) => k.entity))].sort(),
    [keys, source],
  );
  const metrics = useMemo(
    () => [...new Set(keys.filter((k) => k.source === source && k.entity === entity).map((k) => k.metric))].sort(),
    [keys, source, entity],
  );

  function navigate(next: { source: string; entity: string; metric: string }[], nextDays: number) {
    const p = new URLSearchParams();
    for (const k of next.slice(0, MAX_SERIES)) p.append('s', encodeKey(k));
    if (nextDays !== 90) p.set('days', String(nextDays));
    const q = p.toString();
    router.push(q ? `${paths.metrics}?${q}` : paths.metrics);
  }

  function add() {
    const pick = { source, entity, metric };
    if (!source || !entity || !metric) return;
    if (active.some((k) => encodeKey(k) === encodeKey(pick))) return;
    if (active.length >= MAX_SERIES) return;
    navigate([...active, pick], days);
    setMetric('');
  }

  function downloadCsv() {
    const rows = ['source,entity,metric,date,value'];
    for (const s of series) {
      for (const pt of s.points) {
        rows.push([s.source, s.entity, s.metric, pt.date, String(pt.value)].map(csvCell).join(','));
      }
    }
    const url = URL.createObjectURL(new Blob([rows.join('\n') + '\n'], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `metrics-${active.length}-series.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const canAdd = !!source && !!entity && !!metric && active.length < MAX_SERIES;

  return (
    <div className="mt-4">
      {presets.length > 0 && (
        <div className="mono mb-2 flex flex-wrap gap-1.5 text-[11px]">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className="rounded-[3px] border border-[var(--grat)] bg-[var(--scope-1)] px-2 py-0.5 text-ink-3 transition-colors hover:border-[var(--phosphor)] hover:text-ink-2"
              onClick={() => navigate(p.keys, days)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div className="card flex flex-wrap items-center gap-2">
        <select
          className="input mono"
          style={{ width: 'auto', fontSize: 12 }}
          value={source}
          aria-label="Metric source"
          onChange={(e) => {
            setSource(e.target.value);
            setEntity('');
            setMetric('');
          }}
        >
          <option value="">source…</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="input mono"
          style={{ width: 'auto', maxWidth: 240, fontSize: 12 }}
          value={entity}
          disabled={!source}
          aria-label="Metric entity"
          onChange={(e) => {
            setEntity(e.target.value);
            setMetric('');
          }}
        >
          <option value="">entity…</option>
          {entities.map((en) => (
            <option key={en} value={en}>
              {en}
            </option>
          ))}
        </select>
        <select
          className="input mono"
          style={{ width: 'auto', fontSize: 12 }}
          value={metric}
          disabled={!entity}
          aria-label="Metric name"
          onChange={(e) => setMetric(e.target.value)}
        >
          <option value="">metric…</option>
          {metrics.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button type="button" className="btn mono" onClick={add} disabled={!canAdd}>
          + add series
        </button>
        <select
          className="input mono"
          style={{ width: 'auto', fontSize: 12 }}
          value={days}
          aria-label="Time range in days"
          onChange={(e) => navigate(active, Number(e.target.value))}
        >
          {DAY_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}d
            </option>
          ))}
        </select>
        <span className="mono ml-auto flex items-center gap-3 text-[11px]" style={{ color: 'var(--ink-4)' }}>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={series.length === 0}
            className="transition-colors hover:text-[var(--ink-2)] disabled:opacity-50"
            style={{ color: 'inherit', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
          >
            csv ⤓
          </button>
          <a href="/api/dataset" className="transition-colors hover:text-[var(--ink-2)]" title="daily dump of every first-party series (jsonl, gzipped)">
            full dataset ⤓
          </a>
        </span>
      </div>

      {active.length > 0 && (
        <div className="mono mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {active.map((k, i) => (
            <span
              key={encodeKey(k)}
              className="flex items-center gap-1.5 rounded-[3px] border border-[var(--grat)] bg-[var(--scope-1)] px-1.5 py-0.5"
              style={{ color: 'var(--ink-3)' }}
            >
              {k.source}/{k.entity}/{k.metric}
              <button
                type="button"
                aria-label={`remove ${k.entity} ${k.metric}`}
                onClick={() => navigate(active.filter((_, j) => j !== i), days)}
                className="transition-colors hover:text-[var(--alert)]"
                style={{ color: 'var(--ink-4)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
