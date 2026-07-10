'use client';

import { useEffect } from 'react';

/**
 * Marks the visit via POST /api/seen once per mount. Client components survive
 * router.refresh(), so votes and other refreshes don't re-mark the visit —
 * keeping the "since your last visit" divider stable for the whole visit.
 */
export default function MarkSeen() {
  useEffect(() => {
    void fetch('/api/seen', { method: 'POST' }).catch(() => {});
  }, []);
  return null;
}
