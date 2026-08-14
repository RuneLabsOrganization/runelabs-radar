'use client';

// Namespace import keeps JSX working under vitest's classic transform (jsx: preserve).
import * as React from 'react';

const STORAGE_KEY = 'radar.theme';

/**
 * Dark/light switch for the scope console. Dark is the brand default — the
 * toggle flips <html data-theme>, persists the choice, and broadcasts
 * 'radar:theme' so canvas surfaces (scope, WebGL backdrop) re-read their
 * CSS tokens. Glyph renders only after mount to stay hydration-stable.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = React.useState<'dark' | 'light'>('dark');
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (next === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage blocked — theme still flips for this session
    }
    window.dispatchEvent(new Event('radar:theme'));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={mounted ? `theme: ${theme} — switch to ${theme === 'dark' ? 'light' : 'dark'}` : 'toggle theme'}
      title="toggle theme"
      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[4px] border border-[var(--grat)] text-[12px] transition-colors hover:border-[var(--grat-strong)] hover:text-[var(--ink-2)]"
      style={{ color: 'var(--ink-3)' }}
    >
      <span aria-hidden>{mounted ? (theme === 'light' ? '☀' : '☾') : '·'}</span>
    </button>
  );
}
