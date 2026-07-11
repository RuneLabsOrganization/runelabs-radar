'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';

// three.js stays out of the server bundle and the critical path.
const RadarField = dynamic(() => import('./RadarField'), { ssr: false });

export default function RadarBackdrop({ intensity }: { intensity?: number }) {
  return <RadarField intensity={intensity} />;
}
