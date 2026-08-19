'use client';

import * as React from 'react';

/** In-page anchors for the (long) board — sticky right under the top bar.
 *  The page passes only the sections it actually renders, so anonymous
 *  visitors never see anchors to gated (absent) sections. */
export default function BoardNav({ sections }: { sections: readonly (readonly [string, string])[] }) {
  return (
    <nav
      className="mono sticky top-12 z-10 -mx-6 mb-2 flex items-center gap-1.5 overflow-x-auto border-b border-[var(--grat-soft)] bg-[var(--header-bg)] px-6 py-2 text-[10px] tracking-[0.08em] backdrop-blur"
      aria-label="Board sections"
    >
      {sections.map(([id, label]) => (
        <a
          key={id}
          href={`#${id}`}
          className="rounded-[3px] border border-transparent px-2 py-0.5 uppercase text-[var(--ink-3)] transition-colors hover:border-[var(--grat)] hover:text-[var(--ink-2)]"
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
