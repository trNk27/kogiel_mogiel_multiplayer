/** Kurnik: a hen in front of a little red coop. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M10 84 H90" stroke="#c79a68" stroke-width="6" stroke-linecap="round" />
      {/* The coop. */}
      <path d="M50 18 L80 38 H20 Z" fill="#8a2a2a" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <rect x="25" y="38" width="50" height="38" fill="#ff3d6e" stroke="#2a120a" stroke-width="3" />
      <rect x="44" y="52" width="14" height="24" rx="2" fill="#24120c" />
      <circle cx="35" cy="48" r="4" fill="#24120c" />
      {/* The hen. */}
      <g transform="translate(64 66)">
        <ellipse cx="0" cy="6" rx="15" ry="12" fill="#f7f0e2" stroke="#2a120a" stroke-width="3" />
        <path d="M-12 0 L-22 -8 L-15 6 Z" fill="#e8dcc4" stroke="#2a120a" stroke-width="2.5" stroke-linejoin="round" />
        <circle cx="10" cy="-6" r="8" fill="#f7f0e2" stroke="#2a120a" stroke-width="3" />
        <path d="M8 -14 q2 -6 5 -1 q3 -5 4 2" fill="#e0302a" stroke="#2a120a" stroke-width="2" />
        <path d="M17 -7 L24 -5 L17 -3 Z" fill="#f5a020" stroke="#2a120a" stroke-width="2" stroke-linejoin="round" />
        <circle cx="12" cy="-7" r="1.8" fill="#2a120a" />
        <path d="M-6 6 q6 6 12 0" fill="none" stroke="#c9b894" stroke-width="2.5" stroke-linecap="round" />
        <path d="M-4 17 v6 M4 17 v6" stroke="#f5a020" stroke-width="3" stroke-linecap="round" />
      </g>
      <circle cx="18" cy="70" r="5" fill="#ffc531" stroke="#2a120a" stroke-width="2.5" />
    </svg>
  );
}
