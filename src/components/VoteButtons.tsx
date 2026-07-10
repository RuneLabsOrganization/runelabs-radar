'use client';

// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function VoteButtons({
  storyId,
  up,
  down,
  myVote,
}: {
  storyId: number;
  up: number;
  down: number;
  myVote: 1 | -1 | 0;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function vote(value: 1 | -1) {
    if (busy) return;
    setBusy(true);
    try {
      // Clicking my current vote again removes it (value 0).
      const next = myVote === value ? 0 : value;
      const res = await fetch('/api/votes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId, value: next }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="mono inline-flex items-center gap-2.5 text-[11px]">
      <button
        type="button"
        aria-label="Upvote"
        aria-pressed={myVote === 1}
        disabled={busy}
        onClick={() => vote(1)}
        className="vote-btn"
      >
        &#9650;&#8202;{up}
      </button>
      <button
        type="button"
        aria-label="Downvote"
        aria-pressed={myVote === -1}
        disabled={busy}
        onClick={() => vote(-1)}
        className="vote-btn down"
      >
        &#9660;{down > 0 ? ` ${down}` : ''}
      </button>
    </span>
  );
}
