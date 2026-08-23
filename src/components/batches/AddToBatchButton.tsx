'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Add an opportunity/story to the user's first workspace batch (or create one). */
export function AddToBatchButton({
  refType,
  refId,
  refKey,
}: {
  refType: 'opportunity' | 'story' | 'entity' | 'idea';
  refId?: number;
  refKey?: string;
}) {
  const [state, setState] = React.useState<'idle' | 'pending' | 'ok' | 'err'>('idle');
  const [msg, setMsg] = React.useState('');

  async function add() {
    setState('pending');
    const list = await fetch('/api/batches/mine').then((r) => r.json()).catch(() => null);
    let slug: string | undefined = list?.batches?.[0]?.slug;
    if (!slug) {
      const created = await fetch('/api/batches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'My workspace' }),
      });
      if (!created.ok) {
        setState('err');
        setMsg('Sign in to save batches');
        return;
      }
      slug = ((await created.json()) as { slug: string }).slug;
    }
    const res = await fetch(`/api/batches/${encodeURIComponent(slug!)}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refType, refId, refKey }),
    });
    if (!res.ok) {
      setState('err');
      setMsg('Could not add');
      return;
    }
    setState('ok');
    setMsg('Added');
    setTimeout(() => setState('idle'), 2000);
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={add} disabled={state === 'pending'}>
      <Plus className="h-3.5 w-3.5" />
      {state === 'ok' ? msg : state === 'err' ? msg : 'Add to batch'}
    </Button>
  );
}
