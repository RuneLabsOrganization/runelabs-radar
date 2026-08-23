'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';

// three.js stays out of the server bundle and the critical path.
const RadarField = dynamic(() => import('./RadarField'), { ssr: false });

/**
 * Mounts the WebGL scope backdrop only where it earns its cost: fine pointers
 * (mouse) on viewports ≥768px, with reduced-motion off. On phones and
 * reduced-motion setups we render nothing — the CSS scope-0 canvas is the
 * backdrop, and the GPU/battery stays idle.
 */
export default function RadarBackdrop({ intensity, fps }: { intensity?: number; fps?: number }) {
  const [enabled, setEnabled] = React.useState(false);
  // theme flips re-mount the field so it re-reads the flipped CSS tokens
  const [themeKey, setThemeKey] = React.useState(0);
  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px) and (pointer: fine)');
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setEnabled(mq.matches && !rm.matches);
    update();
    mq.addEventListener('change', update);
    rm.addEventListener('change', update);
    const onTheme = () => setThemeKey((k) => k + 1);
    window.addEventListener('radar:theme', onTheme);
    return () => {
      mq.removeEventListener('change', update);
      rm.removeEventListener('change', update);
      window.removeEventListener('radar:theme', onTheme);
    };
  }, []);
  if (!enabled) return null;
  return <RadarField key={themeKey} intensity={intensity} fps={fps} />;
}
