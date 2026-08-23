'use client';

import * as React from 'react';

/**
 * Publishes the sticky header's live height as `--app-header-h`.
 *
 * The app chrome is no longer a fixed 48px — it grows by a row when the
 * active workspace has section tabs, and by another on narrow screens where
 * the workspace switcher gets its own line. In-page sticky strips anchor to
 * this variable so they always land just below the chrome instead of
 * disappearing behind it.
 */
export function HeaderOffset({ targetId }: { targetId: string }) {
  React.useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) return;

    const apply = () => {
      document.documentElement.style.setProperty('--app-header-h', `${el.offsetHeight}px`);
    };
    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--app-header-h');
    };
  }, [targetId]);

  return null;
}
