// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import { signalLevel } from '@/lib/feed';

/** The signature glyph: a 4-bar signal meter, phosphor-lit by relevance score. */
export default function SignalMeter({ score, compact = false }: { score: number; compact?: boolean }) {
  const level = signalLevel(score);
  const heights = compact ? [3, 5, 7, 9] : [4, 7, 10, 13];
  return (
    <span
      className="inline-flex shrink-0 items-end gap-[2px]"
      role="img"
      aria-label={`score ${score} of 100`}
      title={`score ${score}`}
    >
      {heights.map((h, i) => (
        <span
          key={i}
          aria-hidden
          className="w-[3px] rounded-[1px]"
          style={{ height: h, background: i < level ? 'var(--phosphor)' : 'var(--grat-strong)' }}
        />
      ))}
    </span>
  );
}
