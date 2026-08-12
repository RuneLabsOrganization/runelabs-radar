'use client';

import * as React from 'react';
import { useState } from 'react';
import type { OppBrief as OppBriefType } from '@/lib/opportunities/brief';
import OppBrief from './OppBrief';

/**
 * The launch-brief flow, shared by opportunity cards and detail pages:
 * shows the pre-generated brief when present, drafts one on demand for
 * logged-in users (POST /api/opportunities/[id]/brief), and explains the
 * sign-in wall to anonymous visitors.
 */
export default function BriefSection({
  id,
  canGenerate,
  initialBrief,
}: {
  id: number;
  canGenerate: boolean;
  initialBrief: OppBriefType | null;
}) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState<OppBriefType | null>(initialBrief);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function expand() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!canGenerate && !brief) return;
    if (brief || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${id}/brief`, { method: 'POST' });
      const data = (await res.json().catch(() => null)) as { brief?: OppBriefType; error?: string } | null;
      if (res.ok && data?.brief) setBrief(data.brief);
      else setError(data?.error ?? `request failed (${res.status})`);
    } catch {
      setError('request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={expand} className={open ? 'btn' : 'btn btn-primary'}>
        {open ? 'collapse' : brief ? 'launch brief' : canGenerate ? 'draft launch brief' : 'launch brief (sign in)'}
      </button>
      {open &&
        (brief ? (
          <OppBrief brief={brief} />
        ) : loading ? (
          <p className="mono mt-4 text-[11px]" style={{ color: 'var(--phosphor)' }}>
            drafting brief from live market data&hellip;
          </p>
        ) : error ? (
          <p className="mono mt-4 text-[11px]" style={{ color: 'var(--alert)' }}>
            {error}
          </p>
        ) : !canGenerate ? (
          <p className="mono mt-4 text-[11px]" style={{ color: 'var(--ink-3)' }}>
            sign in to generate the launch brief
          </p>
        ) : null)}
    </div>
  );
}
