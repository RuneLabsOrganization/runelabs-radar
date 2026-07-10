// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import type { stories } from '@/lib/db/schema';
import type { Domain } from '@/lib/domains';
import DomainChips, { parseDomainScores } from './DomainChips';
import VoteButtons from './VoteButtons';

export type Story = typeof stories.$inferSelect;

/** Compact relative time: "just now", "5m ago", "3h ago", "2d ago". */
export function timeAgo(d: Date): string {
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function StoryCard({
  story,
  itemCount,
  firstUrl,
  up,
  down,
  myVote,
  highlightDomain,
}: {
  story: Story;
  itemCount: number;
  firstUrl: string | null;
  up: number;
  down: number;
  myVote: 1 | -1 | 0;
  highlightDomain?: Domain;
}) {
  const scores = parseDomainScores(story.domainScores);
  return (
    <article className="card flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <h3 className="text-[14px] font-semibold leading-snug">
          {firstUrl ? (
            <a href={firstUrl} target="_blank" rel="noreferrer" className="hover:underline">
              {story.title}
            </a>
          ) : (
            story.title
          )}
        </h3>
        <div className="muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          <span>{timeAgo(story.createdAt)}</span>
          <span aria-hidden>&middot;</span>
          <span>{itemCount === 1 ? '1 source' : `${itemCount} sources`}</span>
          <DomainChips scores={scores} highlight={highlightDomain} />
        </div>
        {story.tldr && <p className="mt-2 text-[13px]">{story.tldr}</p>}
        {story.whyItMatters && (
          <p
            className="mt-2 rounded-md px-3 py-2 text-[13px]"
            style={{ background: 'var(--accent-soft)' }}
          >
            <span className="font-semibold" style={{ color: 'var(--accent)' }}>
              Why it matters:{' '}
            </span>
            {story.whyItMatters}
          </p>
        )}
      </div>
      <div className="shrink-0">
        <VoteButtons storyId={story.id} up={up} down={down} myVote={myVote} />
      </div>
    </article>
  );
}
