// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import { DOMAINS, DOMAIN_COLORS, DOMAIN_LABELS, type Domain } from '@/lib/domains';

/**
 * The graphic answer to "how does this story hit OUR six needs": one tiny
 * bar per sector, height = relevance score, dimmed below the membership
 * threshold. Reads as a fingerprint — coding-heavy, video-heavy, broad…
 */
export default function DomainFingerprint({
  scores,
  highlight,
}: {
  scores: Partial<Record<Domain, number>> | null;
  highlight?: Domain;
}) {
  if (!scores) return null;
  const detail = DOMAINS.map((d) => `${DOMAIN_LABELS[d]} ${scores[d] ?? 0}`).join(' · ');
  return (
    <span
      className="inline-flex shrink-0 items-end gap-[2px]"
      role="img"
      aria-label={`sector relevance: ${detail}`}
      title={detail}
    >
      {DOMAINS.map((d) => {
        const v = scores[d] ?? 0;
        const member = v >= 40;
        return (
          <span
            key={d}
            aria-hidden
            className="rounded-[1px]"
            style={{
              width: 3,
              height: 2 + (v / 100) * 12,
              background: DOMAIN_COLORS[d],
              opacity: highlight === d ? 1 : member ? 0.9 : 0.22,
            }}
          />
        );
      })}
    </span>
  );
}
