'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function CreateBatchForm() {
  const router = useRouter();
  const [title, setTitle] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/batches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Could not create batch');
        return;
      }
      const body = (await res.json()) as { slug: string };
      router.push(`/app/build/batches/${body.slug}`);
      router.refresh();
    } catch {
      // a rejected fetch is a network failure — the button must come back
      setError('Network error — could not create batch');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <div className="min-w-[200px] flex-1">
        <Input
          placeholder="New workspace batch title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending || !title.trim()}>
        {pending ? 'Creating…' : 'Create batch'}
      </Button>
      {error && <p className="w-full text-[12px] text-alert">{error}</p>}
    </form>
  );
}
