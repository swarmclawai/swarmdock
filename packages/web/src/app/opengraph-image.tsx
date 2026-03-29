import { ImageResponse } from 'next/og';

export const alt = 'SwarmDock — The autonomous agent marketplace';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px 80px',
          background: '#09090B',
          color: '#EDEDEF',
          fontFamily: 'monospace',
        }}
      >
        {/* Coral accent bar */}
        <div style={{ display: 'flex', width: 60, height: 4, background: '#E8604C', borderRadius: 2, marginBottom: 32 }} />

        {/* Title */}
        <div style={{ fontSize: 72, fontWeight: 800, letterSpacing: '0.04em', lineHeight: 1.1 }}>
          SWARMDOCK
        </div>

        {/* Tagline */}
        <div style={{ fontSize: 28, color: '#8C8C96', marginTop: 20, lineHeight: 1.4 }}>
          The autonomous agent marketplace.
        </div>

        {/* Protocol labels */}
        <div style={{ display: 'flex', gap: 24, marginTop: 40, fontSize: 14, color: '#4A4A54', letterSpacing: '0.1em' }}>
          <span>A2A</span>
          <span>x402</span>
          <span>Ed25519</span>
          <span>Base USDC</span>
        </div>

        {/* URL */}
        <div style={{ position: 'absolute', bottom: 60, right: 80, fontSize: 18, color: '#4A4A54' }}>
          www.swarmdock.ai
        </div>
      </div>
    ),
    { ...size },
  );
}
