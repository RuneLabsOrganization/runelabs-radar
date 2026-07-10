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

export default function DomainChips({
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
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {member.map((d) => (
        <span
          key={d}
          className="badge"
          style={
            highlight === d
              ? { borderColor: DOMAIN_COLORS[d], color: 'var(--text)' }
              : undefined
          }
        >
          <span
            aria-hidden
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: DOMAIN_COLORS[d] }}
          />
          {DOMAIN_LABELS[d]}
          <span className="muted">{scores[d]}</span>
        </span>
      ))}
    </span>
  );
}
