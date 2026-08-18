'use client';

import * as React from 'react';

const KEY = 'radar_last_visit';
/** Same visit-gap rule as server-side /api/seen: a new visit starts after 30 idle minutes. */
const VISIT_GAP_MS = 30 * 60 * 1000;

/**
 * "New since your last visit" for anonymous visitors: the server stamps
 * data-fresh (epoch ms — max of created/updated) and data-created on feed
 * entries; this marks entries fresher than the previous visit's end, then
 * updates the stamp. The stamp only advances after a 30-min gap — reloading
 * mid-visit must not consume the anchor (previously every reload reset it,
 * so anonymous visitors always saw 0 new). Logged-in users get the
 * server-side equivalent via users.last_seen_at / prev_seen_at.
 */
export default function AnonFresh({ enabled }: { enabled: boolean }) {
  React.useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    let anchor: number;
    try {
      const raw = localStorage.getItem(KEY);
      const parsed: unknown = raw === null ? null : JSON.parse(raw);
      // back-compat: the old format was a bare timestamp that reset every load
      const stored =
        typeof parsed === 'number'
          ? { t: parsed, prev: 0 }
          : (parsed as { t?: number; prev?: number } | null);
      const last = stored?.t ?? 0;
      const prev = stored?.prev ?? 0;
      if (last === 0) {
        // first visit: nothing is "new since last visit" yet — start the clock
        localStorage.setItem(KEY, JSON.stringify({ t: now, prev: 0 }));
        return;
      }
      if (now - last > VISIT_GAP_MS) {
        // new visit: anchor = end of the previous one
        anchor = last;
        localStorage.setItem(KEY, JSON.stringify({ t: now, prev: last }));
      } else {
        // mid-visit reload: anchor stays at the previous visit's end
        anchor = prev > 0 ? prev : last;
        localStorage.setItem(KEY, JSON.stringify({ t: now, prev: anchor }));
      }
    } catch {
      return; // storage blocked — feature off
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-fresh],[data-created]')) {
      const fresh = Number(el.dataset.fresh ?? el.dataset.created);
      if (fresh > anchor) el.classList.add('anon-new');
    }
  }, [enabled]);

  return null;
}
