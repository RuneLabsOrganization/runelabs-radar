'use client';

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

/** Quiet mono copy-to-clipboard button: `copy` → `copied ✓` for 2s, with a
 *  textarea fallback for non-secure contexts. */
export default function CopyButton({ text, label = 'copy playbook' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  // tracked so unmount never leaves a dangling setState timer
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback for insecure contexts / older browsers
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="mono cursor-pointer border-0 bg-transparent p-0 text-[10.5px] uppercase tracking-[0.08em] transition-colors"
      style={{ color: copied ? 'var(--phosphor)' : 'var(--ink-3)' }}
    >
      {copied ? 'copied ✓' : label}
    </button>
  );
}
