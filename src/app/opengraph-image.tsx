import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Scope-console OG card: canvas, graticule rings, phosphor sweep, wordmark. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          background: '#0a0e13',
          padding: 72,
          position: 'relative',
          fontFamily: 'monospace',
        }}
      >
        {/* graticule rings */}
        {[560, 420, 280, 140].map((d) => (
          <div
            key={d}
            style={{
              position: 'absolute',
              right: -d / 2 + 120,
              top: -d / 2 + 80,
              width: d,
              height: d,
              borderRadius: '50%',
              border: '1px solid rgba(151, 180, 205, 0.13)',
            }}
          />
        ))}
        {/* sweep beam */}
        <div
          style={{
            position: 'absolute',
            right: 60,
            top: -140,
            width: 90,
            height: 700,
            transform: 'rotate(38deg)',
            background: 'linear-gradient(90deg, transparent, rgba(87,217,163,0.22), transparent)',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 6, height: 34, background: '#57d9a3' }} />
          <div style={{ color: '#e3eaf0', fontSize: 44, letterSpacing: 6 }}>
            RUNELABS RADAR
          </div>
        </div>
        <div style={{ color: '#8295a6', fontSize: 24, marginTop: 14, letterSpacing: 2 }}>
          best stacks and business openings in the AI landscape — updated daily
        </div>
      </div>
    ),
    size,
  );
}
