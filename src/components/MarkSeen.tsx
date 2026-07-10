'use client';

import { useEffect } from 'react';

/**
 * Marks the visit via POST /api/seen once per mount. Client components survive
 * router.refresh(), so votes and other refreshes don't re-mark the visit —
 * keeping the "since your last visit" divider stable for the whole visit.
 */
export default function MarkSeen() {
  useEffect(() => {
    const mark = () => void fetch('/api/seen', { method: 'POST' }).catch(() => {});
    mark();
    // Heartbeat keeps lastSeenAt fresh during long reads so the visit-gap
    // logic never mistakes the current visit for a new one mid-session.
    const timer = setInterval(mark, 5 * 60_000);
    return () => clearInterval(timer);
  }, []);
  return null;
}
