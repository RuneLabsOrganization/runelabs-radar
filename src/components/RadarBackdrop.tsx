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
export default function RadarBackdrop({ intensity }: { intensity?: number }) {
  const [enabled, setEnabled] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px) and (pointer: fine)');
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setEnabled(mq.matches && !rm.matches);
    update();
    mq.addEventListener('change', update);
    rm.addEventListener('change', update);
    return () => {
      mq.removeEventListener('change', update);
      rm.removeEventListener('change', update);
    };
  }, []);
  if (!enabled) return null;
  return <RadarField intensity={intensity} />;
}
