import { encode } from 'uqr';

/** QR code rendered as a single SVG path (crisp at any TV size). */
export function QrCode({ text, size = 320, dark = '#2a120a' }: { text: string; size?: number; dark?: string }) {
  const qr = encode(text, { ecc: 'M', border: 0 });
  const n = qr.size;
  let d = '';
  qr.data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} shape-rendering="crispEdges" role="img" aria-label={`QR code for ${text}`}>
      <path d={d} fill={dark} />
    </svg>
  );
}
