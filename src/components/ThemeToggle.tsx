'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'radar.theme';

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
      /* storage blocked */
    }
    window.dispatchEvent(new Event('radar:theme'));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={mounted ? `theme: ${theme} — switch to ${theme === 'dark' ? 'light' : 'dark'}` : 'toggle theme'}
      title="toggle theme"
      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border border-grat text-ink-3 transition-colors hover:border-grat-strong hover:text-ink-2"
    >
      {mounted ? (
        theme === 'light' ? (
          <Sun className="h-3.5 w-3.5" />
        ) : (
          <Moon className="h-3.5 w-3.5" />
        )
      ) : (
        <span className="text-[10px]">·</span>
      )}
    </button>
  );
}
