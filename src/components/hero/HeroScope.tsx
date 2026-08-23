'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';

// three.js stays out of the server bundle and off the critical path.
const HeroField = dynamic(() => import('./HeroField'), { ssr: false });

/**
 * Mounts the WebGL hero only where it earns its cost: viewports ≥768px with a
 * fine pointer. Phones keep the CSS gradient, and the GPU stays idle.
 * Reduced-motion still mounts — HeroField renders a single static frame.
 */
export default function HeroScope({ intensity = 1 }: { intensity?: number }) {
  const [enabled, setEnabled] = React.useState(false);
  const [themeKey, setThemeKey] = React.useState(0);

  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px) and (pointer: fine)');
    const update = () => setEnabled(mq.matches);
    update();
    mq.addEventListener('change', update);
    // the field samples CSS tokens once, so a theme flip has to re-mount it
    const onTheme = () => setThemeKey((k) => k + 1);
    window.addEventListener('radar:theme', onTheme);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('radar:theme', onTheme);
    };
  }, []);

  if (!enabled) return null;
  return <HeroField key={themeKey} intensity={intensity} />;
}
