'use client';

import * as React from 'react';

const KEY = 'radar_last_visit';

/**
 * "New since your last visit" for anonymous visitors: the server stamps
 * data-created (epoch ms) on feed entries; this marks entries newer than
 * the stored timestamp with a phosphor dot, then updates the stamp.
 * Logged users get the server-side equivalent via users.last_seen_at.
 */
export default function AnonFresh({ enabled }: { enabled: boolean }) {
  React.useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    let last = 0;
    try {
      last = Number(localStorage.getItem(KEY) ?? 0) || 0;
      localStorage.setItem(KEY, String(now));
    } catch {
      return; // storage blocked — feature off
    }
    if (last === 0) return; // first visit: nothing is "new since last visit"
    for (const el of document.querySelectorAll<HTMLElement>('[data-created]')) {
      const created = Number(el.dataset.created);
      if (created > last) el.classList.add('anon-new');
    }
  }, [enabled]);

  return null;
}
