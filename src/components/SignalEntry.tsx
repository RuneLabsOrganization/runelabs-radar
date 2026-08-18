// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import Link from 'next/link';
import { type Domain } from '@/lib/domains';
import { timeAgo, type FeedStory } from '@/lib/feed';
import { safeHttpUrl } from '@/lib/safe-url';
import { parseDomainScores, topDomain } from './DomainChips';
import DomainFingerprint from './DomainFingerprint';
import SignalMeter from './SignalMeter';
import VoteButtons from './VoteButtons';

/** A top-signal contact: full briefing entry, hairline-divided — no card chrome. */
export default function SignalEntry({
  story,
  itemCount,
  firstUrl,
  sourceName,
  up,
  down,
  myVote,
  isNew = false,
  highlightDomain,
  readOnly = false,
  timeLabel,
  hero = false,
}: {
  story: FeedStory;
  itemCount: number;
  firstUrl: string | null;
  sourceName: string | null;
  up: number;
  down: number;
  myVote: 1 | -1 | 0;
  isNew?: boolean;
  highlightDomain?: Domain;
  readOnly?: boolean;
  /** precomputed server-side when rendered under a client boundary (hydration-stable) */
  timeLabel?: string;
  /** lead-story treatment: larger title, more air — one per page */
  hero?: boolean;
}) {
  const scores = parseDomainScores(story.domainScores);
  const href = safeHttpUrl(firstUrl);
  return (
    <article
      className={`border-b border-[var(--grat-soft)] last:border-b-0 ${hero ? 'py-7' : 'py-5'}`}
      data-created={story.createdAt.getTime()}
      data-fresh={Math.max(story.createdAt.getTime(), story.updatedAt?.getTime() ?? 0)}
    >
      <div className="flex items-start gap-3.5">
        <div className="pt-[5px]">
          <SignalMeter score={story.topScore} />
        </div>
        <div className="min-w-0 flex-1">
          <h3
            className={
              hero
                ? 'text-[19px] leading-snug font-semibold tracking-[-0.01em]'
                : 'text-[15px] leading-snug font-semibold tracking-[-0.01em]'
            }
          >
            <Link
              href={`/story/${story.id}`}
              className="decoration-[var(--grat-strong)] underline-offset-2 hover:underline"
            >
              {story.title}
            </Link>
            {href && (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label="open original source"
                title="open original source"
                className="mono ml-1.5 text-[11px]"
                style={{ color: 'var(--ink-4)' }}
              >
                &#8599;
              </a>
            )}
          </h3>
          {story.tldr && (
            <p className="mt-1.5 text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
              {story.tldr}
            </p>
          )}
          {story.whyItMatters && (
            <p
              className="mt-2.5 border-l-2 pl-3 text-[13px] leading-relaxed"
              style={{ borderColor: 'var(--phosphor)', color: 'var(--ink-2)' }}
            >
              <span className="readout" style={{ color: 'var(--phosphor)' }}>
                why it matters
              </span>{' '}
              &mdash; {story.whyItMatters}
            </p>
          )}
          {story.whyShown && (
            <p className="mono mt-1.5 text-[10.5px] tracking-[0.04em]" style={{ color: 'var(--ink-4)' }}>
              on the radar because <span style={{ color: 'var(--ink-3)' }}>{story.whyShown}</span>
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {isNew && (
              <span className="readout" style={{ color: 'var(--phosphor)' }}>
                &#9679; new
              </span>
            )}
            <span className="mono text-[11px]" style={{ color: 'var(--ink-4)' }}>
              {timeLabel ?? timeAgo(story.createdAt)}
            </span>
            {sourceName && (
              <span className="mono text-[11px]" style={{ color: 'var(--ink-4)' }}>
                {sourceName}
                {itemCount > 1 ? ` +${itemCount - 1}` : ''}
              </span>
            )}
            <DomainFingerprint scores={scores} highlight={highlightDomain ?? topDomain(scores) ?? undefined} />
            <span className="ml-auto">
              <VoteButtons storyId={story.id} up={up} down={down} myVote={myVote} readOnly={readOnly} />
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
