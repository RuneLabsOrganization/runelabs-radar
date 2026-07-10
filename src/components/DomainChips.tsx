// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';
import {
  DOMAINS,
  DOMAIN_COLORS,
  DOMAIN_LABELS,
  DOMAIN_MEMBERSHIP_THRESHOLD,
  type Domain,
} from '@/lib/domains';

/** Parse the stories.domainScores JSON column into a typed score map. */
export function parseDomainScores(json: string | null): Partial<Record<Domain, number>> | null {
  if (!json) return null;
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    if (typeof obj !== 'object' || obj === null) return null;
    const out: Partial<Record<Domain, number>> = {};
    for (const d of DOMAINS) {
      const v = obj[d];
      if (typeof v === 'number' && Number.isFinite(v)) out[d] = v;
    }
    return out;
  } catch {
    return null;
  }
}

/** The story's strongest domain (>= membership threshold), or null. */
export function topDomain(scores: Partial<Record<Domain, number>> | null): Domain | null {
  if (!scores) return null;
  let best: Domain | null = null;
  let bestScore = DOMAIN_MEMBERSHIP_THRESHOLD - 1;
  for (const d of DOMAINS) {
    const v = scores[d] ?? 0;
    if (v > bestScore) {
      best = d;
      bestScore = v;
    }
  }
  return best;
}

/** Quiet sector identification: a colored tick + mono label per member domain. */
export default function SectorTicks({
  scores,
  highlight,
}: {
  scores: Partial<Record<Domain, number>> | null;
  highlight?: Domain;
}) {
  if (!scores) return null;
  const member = DOMAINS.filter((d) => (scores[d] ?? 0) >= DOMAIN_MEMBERSHIP_THRESHOLD);
  if (member.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {member.map((d) => (
        <span
          key={d}
          className="mono inline-flex items-center gap-[5px] text-[10.5px] tracking-[0.06em]"
          style={{ color: highlight === d ? 'var(--ink-2)' : 'var(--ink-4)' }}
        >
          <span aria-hidden className="inline-block h-[9px] w-[2px]" style={{ background: DOMAIN_COLORS[d] }} />
          {DOMAIN_LABELS[d].toUpperCase()} {scores[d]}
        </span>
      ))}
    </span>
  );
}
