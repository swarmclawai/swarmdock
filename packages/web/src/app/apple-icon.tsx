import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0A0A0A',
          borderRadius: 36,
        }}
      >
        <span style={{ fontFamily: 'monospace', fontSize: 72, fontWeight: 700, color: '#00FF88' }}>
          SD
        </span>
      </div>
    ),
    { ...size },
  );
}
