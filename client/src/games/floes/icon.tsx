/** Kra: a pierogi hopping between hexagonal ice floes over dark water, one cracking under it. */
export function Icon({ size }: { size: number }) {
  const hex = (cx: number, cy: number, r: number) =>
    Array.from({ length: 6 }, (_, k) => {
      const a = (Math.PI / 3) * k + Math.PI / 6;
      return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r * 0.55).toFixed(1)}`;
    }).join(' ');
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#1d2448" />
      <path d="M10 84 Q30 78 50 84 T90 84" fill="none" stroke="#5f86b8" stroke-width="3" stroke-linecap="round" />
      <polygon points={hex(27, 66, 17)} fill="#b9def5" stroke="#14142e" stroke-width="3" stroke-linejoin="round" />
      <polygon points={hex(73, 66, 17)} fill="#f6fbff" stroke="#14142e" stroke-width="3" stroke-linejoin="round" />
      <path d="M20 64 l6 3 l4 -4 l5 3" fill="none" stroke="#3a5a78" stroke-width="2" stroke-linecap="round" />
      <path d="M47 80 l3 -6 l3 6" fill="none" stroke="#e8f4ff" stroke-width="3" stroke-linecap="round" />
      <ellipse cx="50" cy="66" rx="9" ry="2.5" fill="#000" opacity=".3" />
      <g transform="translate(50 42) rotate(-10)">
        <path d="M-17 0 A17 17 0 0 1 17 0 Z" fill="#ffd23f" stroke="#14142e" stroke-width="3" stroke-linejoin="round" />
        <path d="M-13 -2 A13 13 0 0 1 13 -2" fill="none" stroke="#d9a80a" stroke-width="2.5" stroke-dasharray="2 4" stroke-linecap="round" />
        <circle cx="-5" cy="-7" r="2.4" fill="#14142e" />
        <circle cx="5" cy="-7" r="2.4" fill="#14142e" />
      </g>
      <circle cx="22" cy="22" r="2" fill="#fff6e0" />
      <circle cx="78" cy="18" r="1.6" fill="#fff6e0" />
      <circle cx="64" cy="27" r="1.2" fill="#fff6e0" />
    </svg>
  );
}
