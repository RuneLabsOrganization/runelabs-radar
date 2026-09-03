'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';

export function BatchRunControls({ batchId }: { batchId: number }) {
  const [status, setStatus] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<'debate' | 'plan' | null>(null);

  async function run(op: 'debate' | 'plan') {
    setPending(op);
    setStatus(null);
    try {
      const res = await fetch(`/api/batches/${batchId}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; stats?: string; status?: string };
      if (!res.ok) {
        setStatus(body.error ?? 'Run failed');
        return;
      }
      setStatus(`Run ${body.status}${body.stats ? ` · ${body.stats}` : ''}`);
    } catch {
      // a rejected fetch is a network failure — the buttons must come back
      setStatus('Network error — run failed');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={!!pending} onClick={() => run('debate')}>
        {pending === 'debate' ? 'Debating…' : 'Debate all'}
      </Button>
      <Button size="sm" variant="outline" disabled={!!pending} onClick={() => run('plan')}>
        {pending === 'plan' ? 'Planning…' : 'Generate plans'}
      </Button>
      {status && <span className="mono text-[11px] text-ink-3">{status}</span>}
    </div>
  );
}
