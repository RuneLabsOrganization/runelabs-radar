'use client';

// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function VoteButtons({
  storyId,
  up,
  down,
  myVote,
  readOnly = false,
}: {
  storyId: number;
  up: number;
  down: number;
  myVote: 1 | -1 | 0;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  // tracked so unmount never leaves a dangling setState timer
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (errorTimer.current) clearTimeout(errorTimer.current);
    },
    [],
  );
  // optimistic display state — resyncs when server props change after refresh
  const [view, setView] = useState({ up, down, mine: myVote });
  useEffect(() => {
    setView({ up, down, mine: myVote });
  }, [up, down, myVote]);

  if (readOnly) {
    return (
      <span className="mono inline-flex items-center gap-2.5 text-[11px]" style={{ color: 'var(--ink-4)' }}>
        <span>&#9650;&#8202;{up}</span>
        <span>&#9660;{down > 0 ? ` ${down}` : ''}</span>
      </span>
    );
  }

  function optimistic(next: 1 | -1 | 0) {
    const cur = view;
    const delta = { up: cur.up, down: cur.down };
    if (cur.mine === 1) delta.up -= 1;
    if (cur.mine === -1) delta.down -= 1;
    if (next === 1) delta.up += 1;
    if (next === -1) delta.down += 1;
    return { ...delta, mine: next };
  }

  async function vote(value: 1 | -1) {
    if (busy) return;
    const next = view.mine === value ? 0 : value;
    const prev = view;
    setView(optimistic(next));
    setError(false);
    setBusy(true);
    try {
      const res = await fetch('/api/votes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId, value: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setView(prev); // rollback
      setError(true);
      if (errorTimer.current) clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(() => setError(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="mono inline-flex items-center gap-2.5 text-[11px]" aria-live="polite">
      <button
        type="button"
        aria-label="Upvote"
        aria-pressed={view.mine === 1}
        disabled={busy}
        onClick={() => vote(1)}
        className="vote-btn"
      >
        &#9650;&#8202;{view.up}
      </button>
      <button
        type="button"
        aria-label="Downvote"
        aria-pressed={view.mine === -1}
        disabled={busy}
        onClick={() => vote(-1)}
        className="vote-btn down"
      >
        &#9660;{view.down > 0 ? ` ${view.down}` : ''}
      </button>
      {error && (
        <span className="text-[10px]" style={{ color: 'var(--alert)' }}>
          vote failed
        </span>
      )}
    </span>
  );
}
