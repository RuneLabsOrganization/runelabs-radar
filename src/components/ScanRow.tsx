// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import { DOMAIN_COLORS, DOMAIN_LABELS, type Domain } from '@/lib/domains';
import { timeAgo, type FeedStory } from '@/lib/feed';
import { safeHttpUrl } from '@/lib/safe-url';
import SignalMeter from './SignalMeter';

/** A scan-log contact: one dense line in the sweep record. */
export default function ScanRow({
  story,
  firstUrl,
  score,
  domain,
  isNew = false,
  timeLabel,
}: {
  story: FeedStory;
  firstUrl: string | null;
  score: number;
  domain: Domain | null;
  isNew?: boolean;
  /** precomputed server-side when rendered under a client boundary (hydration-stable) */
  timeLabel?: string;
}) {
  const href = safeHttpUrl(firstUrl);
  return (
    <li className="row-hover flex items-center gap-3 border-b border-[var(--grat-soft)] px-1 py-[7px] last:border-b-0">
      <SignalMeter score={score} compact />
      <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: 'var(--ink-2)' }}>
        {isNew && (
          <span aria-label="new" style={{ color: 'var(--phosphor)' }}>
            &#9679;{' '}
          </span>
        )}
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="decoration-[var(--grat-strong)] underline-offset-2 hover:underline"
          >
            {story.title}
          </a>
        ) : (
          story.title
        )}
      </span>
      {domain && (
        <span
          className="mono hidden shrink-0 items-center gap-[5px] text-[10.5px] sm:inline-flex"
          style={{ color: 'var(--ink-4)' }}
        >
          <span aria-hidden className="inline-block h-[9px] w-[2px]" style={{ background: DOMAIN_COLORS[domain] }} />
          {DOMAIN_LABELS[domain].toUpperCase()} {score}
        </span>
      )}
      <span className="mono w-14 shrink-0 text-right text-[10.5px]" style={{ color: 'var(--ink-4)' }}>
        {timeLabel ?? timeAgo(story.createdAt)}
      </span>
    </li>
  );
}
