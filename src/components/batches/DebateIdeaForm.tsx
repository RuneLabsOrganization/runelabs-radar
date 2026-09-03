'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function DebateIdeaForm() {
  const [idea, setIdea] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!idea.trim()) return;
    setPending(true);
    setResult(null);
    try {
      const res = await fetch('/api/debates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: idea.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; verdict?: string; confidence?: number };
      if (!res.ok) {
        setResult(body.error ?? 'Debate failed');
        return;
      }
      setResult(`Verdict: ${body.verdict} (${body.confidence}%)`);
      setIdea('');
    } catch {
      // a rejected fetch is a network failure — the button must come back
      setResult('Network error — debate failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <Input
        placeholder="Describe an idea to debate…"
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
      />
      <Button type="submit" disabled={pending || !idea.trim()}>
        {pending ? 'Debating (4 roles)…' : 'Run debate'}
      </Button>
      {result && <p className="text-[12.5px] text-ink-2">{result}</p>}
    </form>
  );
}
