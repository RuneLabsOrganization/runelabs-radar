'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

/**
 * HN-style feed keyboard nav: j/k move a cursor through feed entries
 * (anything stamped with data-created), Enter opens the focused story.
 * No-op on pages without feed entries. Ignores keys while typing.
 */
export default function FeedKeys() {
  const router = useRouter();

  React.useEffect(() => {
    let idx = -1;
    const entries = () => Array.from(document.querySelectorAll<HTMLElement>('[data-created]'));
    const clear = () => {
      for (const el of entries()) el.classList.remove('feed-focus');
    };
    const move = (next: number) => {
      const list = entries();
      if (list.length === 0) return;
      idx = Math.max(0, Math.min(list.length - 1, next));
      clear();
      const el = list[idx];
      el.classList.add('feed-focus');
      el.scrollIntoView({ block: 'nearest' });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'j' || e.key === 'k') {
        move(idx + (e.key === 'j' ? 1 : -1));
      } else if (e.key === 'Enter' && idx >= 0) {
        // leave Enter alone when a real control has focus (link/button does its own thing)
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.tagName === 'A' || active.tagName === 'BUTTON')) return;
        const link = entries()[idx]?.querySelector<HTMLAnchorElement>('a[href^="/story/"]');
        const href = link?.getAttribute('href');
        if (href) router.push(href);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return null;
}
