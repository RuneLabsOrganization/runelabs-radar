/**
 * The summary band on /changelog: counts + the sector with the most contacts
 * over the window. Contacts arrive as their primary domain (null = unscored),
 * moves as their board domain.
 */
export interface ChangelogSummary {
  contacts: number;
  moves: number;
  topSector: string | null;
}

export function changelogSummary(contactDomains: (string | null)[], moveDomains: string[]): ChangelogSummary {
  const counts = new Map<string, number>();
  for (const d of contactDomains) {
    if (!d) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let topSector: string | null = null;
  let best = 0;
  for (const [d, n] of counts) {
    if (n > best) {
      best = n;
      topSector = d;
    }
  }
  return { contacts: contactDomains.length, moves: moveDomains.length, topSector };
}
