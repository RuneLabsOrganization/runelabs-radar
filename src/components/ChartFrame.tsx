'use client';

import * as React from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { exportChartAsPng } from '@/lib/export-png';

/**
 * Wraps a chart with a quiet export affordance (top-right, appears on
 * hover / always visible on touch). Exports the first SVG inside as a
 * watermarked PNG to the clipboard (download fallback).
 */
export default function ChartFrame({
  title,
  brand,
  caption,
  children,
}: {
  title: string;
  brand: string;
  /** derivation formula / as-of line under the chart (TAPE-style honesty) */
  caption?: string;
  children: React.ReactNode;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [state, setState] = useState<'idle' | 'busy' | 'copied' | 'saved' | 'error'>('idle');
  // tracked so unmount never leaves a dangling setState timer
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function onExport() {
    const root = document.getElementById(id);
    if (!root || state === 'busy') return;
    setState('busy');
    try {
      const mode = await exportChartAsPng(root, { title, brand });
      setState(mode === 'clipboard' ? 'copied' : 'saved');
    } catch {
      setState('error');
    } finally {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), 1800);
    }
  }

  const label =
    state === 'busy' ? '…' : state === 'copied' ? 'copied' : state === 'saved' ? 'saved' : state === 'error' ? 'failed' : 'png ⤓';

  return (
    <div className="chart-frame relative">
      <button
        type="button"
        onClick={onExport}
        title="copy chart as PNG"
        aria-label={`export ${title} chart as PNG`}
        className="mono absolute top-0 right-0 z-10 rounded-[3px] border border-[var(--grat)] bg-[var(--scope-1)] px-1.5 py-0.5 text-[10px] tracking-[0.06em] uppercase transition-opacity"
        style={{ color: 'var(--ink-4)' }}
      >
        {label}
      </button>
      <div id={id}>{children}</div>
      {caption && (
        <p className="mono mt-1 text-[10px]" style={{ color: 'var(--ink-4)' }}>
          {caption}
        </p>
      )}
    </div>
  );
}
