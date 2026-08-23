import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** Apple touch icon — scope-console bars + phosphor pip. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          gap: 10,
          background: '#0a0e13',
          paddingBottom: 42,
          borderRadius: 36,
        }}
      >
        <div style={{ width: 18, height: 36, borderRadius: 4, background: 'rgba(87,217,163,0.4)' }} />
        <div style={{ width: 18, height: 56, borderRadius: 4, background: 'rgba(87,217,163,0.7)' }} />
        <div style={{ width: 18, height: 78, borderRadius: 4, background: '#57d9a3' }} />
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            background: '#57d9a3',
            marginBottom: 64,
            marginLeft: 4,
          }}
        />
      </div>
    ),
    { ...size },
  );
}
