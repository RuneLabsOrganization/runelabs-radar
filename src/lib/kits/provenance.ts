/**
 * Evidence independence.
 *
 * A verdict backed by five links to the same vendor is backed by one source.
 * Counting distinct URLs (what kit_picks.distinct_sources did) cannot see that,
 * so confidence could be earned entirely from the vendor's own announcements.
 *
 * We collapse to the registrable domain and require a genuinely independent one
 * before a pick may exceed 'low'. No PSL dependency — a short suffix list covers
 * the hosts that actually appear in AI-tooling evidence, and an unknown suffix
 * degrades to last-two-labels, which is the safe direction (over-merging is
 * conservative: it under-counts independence rather than inventing it).
 */

/** Roles a piece of evidence can play. Mirrors kit_evidence.role. */
export type EvidenceRole = 'first_party' | 'independent' | 'community';

/** Public suffixes with two labels that we actually encounter. */
const TWO_LABEL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'co.jp',
  'co.nz',
  'com.br',
  'co.in',
]);

/** Hosting suffixes where the third label IS the distinct publisher. */
const PROJECT_HOSTS = new Set(['github.io', 'gitlab.io', 'pages.dev', 'vercel.app', 'netlify.app', 'substack.com']);

export function registrableDomain(url: string): string | null {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    host = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.startsWith('www.')) host = host.slice(4);
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return null;

  const lastTwo = labels.slice(-2).join('.');
  // someproject.github.io — the project, not github.io, is the publisher
  if (PROJECT_HOSTS.has(lastTwo) && labels.length >= 3) return labels.slice(-3).join('.');
  if (TWO_LABEL_SUFFIXES.has(lastTwo) && labels.length >= 3) return labels.slice(-3).join('.');
  return lastTwo;
}

export interface EvidenceRef {
  sourceUrl: string;
  role: EvidenceRole;
}

export interface Independence {
  /** Distinct registrable domains across all evidence. */
  distinctDomains: number;
  /** Distinct registrable domains contributed by independent-role evidence. */
  independentDomains: number;
}

export function independence(evidence: EvidenceRef[]): Independence {
  const all = new Set<string>();
  const indep = new Set<string>();
  for (const e of evidence) {
    const domain = registrableDomain(e.sourceUrl);
    if (!domain) continue;
    all.add(domain);
    if (e.role === 'independent') indep.add(domain);
  }
  return { distinctDomains: all.size, independentDomains: indep.size };
}
