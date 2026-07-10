/** A gap longer than this between requests starts a new "visit". */
export const VISIT_GAP_MS = 30 * 60 * 1000;

interface VisitTimestamps {
  lastSeenAt: Date | null;
  prevSeenAt: Date | null;
}

/**
 * The timestamp the "since your last visit" divider and unread logic anchor to.
 * During an active visit lastSeenAt is a heartbeat that advances on /api/seen,
 * so the anchor is the previous visit's timestamp (prevSeenAt); after a gap,
 * lastSeenAt itself is the previous visit.
 */
export function visitAnchor(u: VisitTimestamps, now: number = Date.now()): Date | null {
  if (!u.lastSeenAt) return null;
  const withinVisit = now - u.lastSeenAt.getTime() <= VISIT_GAP_MS;
  return withinVisit ? (u.prevSeenAt ?? u.lastSeenAt) : u.lastSeenAt;
}
