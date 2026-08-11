// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import Link from 'next/link';
import { DOMAINS, DOMAIN_COLORS, DOMAIN_LABELS, type Domain } from '@/lib/domains';
import { timeAgo, type FeedStory } from '@/lib/feed';
import { safeHttpUrl } from '@/lib/safe-url';
import { parseDomainScores } from './DomainChips';
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
}) {
  const scores = parseDomainScores(story.domainScores);
  const href = safeHttpUrl(firstUrl);
  // right rail: the story's strongest fits against OUR domains, labeled
  const topFits = scores
    ? DOMAINS.map((d) => ({ d, v: scores[d] ?? 0 }))
        .filter((x) => x.v > 0)
        .sort((a, b) => b.v - a.v)
        .slice(0, 3)
    : [];
  return (
    <article className="border-b border-[var(--grat-soft)] py-5 last:border-b-0">
      <div className="flex items-start gap-3.5">
        <div className="pt-[5px]">
          <SignalMeter score={story.topScore} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] leading-snug font-semibold tracking-[-0.01em]">
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
          {/* mobile: the relevance rail collapses into inline chips */}
          {topFits.length > 0 && (
            <div className="mono mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] tracking-[0.06em] uppercase md:hidden">
              {topFits.map(({ d, v }) => (
                <span key={d} className="inline-flex items-center gap-1">
                  <span aria-hidden className="inline-block h-[8px] w-[2px]" style={{ background: DOMAIN_COLORS[d] }} />
                  <span style={{ color: 'var(--ink-3)' }}>{DOMAIN_LABELS[d]}</span>
                  <span style={{ color: 'var(--ink-4)' }}>{v}</span>
                </span>
              ))}
            </div>
          )}
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
            <DomainFingerprint scores={scores} highlight={highlightDomain} />
            <span className="ml-auto">
              <VoteButtons storyId={story.id} up={up} down={down} myVote={myVote} readOnly={readOnly} />
            </span>
          </div>
        </div>

        {topFits.length > 0 && (
          <div
            className="mono hidden w-[150px] shrink-0 flex-col gap-[5px] pt-1.5 md:flex"
            role="img"
            aria-label={`relevance: ${topFits.map((f) => `${DOMAIN_LABELS[f.d]} ${f.v}`).join(', ')}`}
          >
            {topFits.map(({ d, v }) => (
              <div key={d} className="flex items-center gap-1.5" aria-hidden>
                <span
                  className="w-[44px] shrink-0 text-right text-[10px] tracking-[0.04em] uppercase"
                  style={{ color: highlightDomain === d ? 'var(--ink-2)' : 'var(--ink-4)' }}
                >
                  {DOMAIN_LABELS[d].length > 7 ? DOMAIN_LABELS[d].slice(0, 6) : DOMAIN_LABELS[d]}
                </span>
                <span className="h-[4px] flex-1 rounded-[1px]" style={{ background: 'var(--grat-soft)' }}>
                  <span
                    className="anim-bar block h-full rounded-[1px]"
                    style={{ width: `${v}%`, background: DOMAIN_COLORS[d], opacity: 0.85 }}
                  />
                </span>
                <span className="w-[18px] shrink-0 text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
                  {v}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
