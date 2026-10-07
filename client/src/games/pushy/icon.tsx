/** Pushy Pierogi: two pierogi on an ice floe, one shoved towards the water. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M8 70 H92 V80 Q92 92 80 92 H20 Q8 92 8 80 Z" fill="#2f6fb3" />
      <path d="M16 82 q5 -4 10 0 t10 0 M60 86 q5 -4 10 0 t10 0" fill="none" stroke="#8fc4f0" stroke-width="3" stroke-linecap="round" />
      <path d="M10 58 L22 50 L62 48 L74 56 L66 70 L24 72 Z" fill="#d8f0fb" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <path d="M40 49 L44 58 L38 64 L42 71" fill="none" stroke="#7aa8c8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M20 54 l6 2 M52 62 l7 -1" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" />
      <g transform="translate(30 58)">
        <path d="M-15 0 A15 15 0 0 1 15 0 Z" fill="#ff3d6e" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <path d="M-12 -2 A12 12 0 0 1 12 -2" fill="none" stroke="#c42a52" stroke-width="2.5" stroke-dasharray="2 4" stroke-linecap="round" />
        <circle cx="-5" cy="-6" r="2.3" fill="#2a120a" />
        <circle cx="5" cy="-6" r="2.3" fill="#2a120a" />
        <path d="M-4 -17 L2 -27 L8 -17 Z" fill="#8f1d3a" stroke="#2a120a" stroke-width="2" stroke-linejoin="round" />
        <circle cx="2" cy="-28" r="2.6" fill="#fff4dc" />
      </g>
      <g transform="translate(74 40) rotate(28)">
        <path d="M-14 0 A14 14 0 0 1 14 0 Z" fill="#ffd23f" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <path d="M-11 -2 A11 11 0 0 1 11 -2" fill="none" stroke="#d9a516" stroke-width="2.5" stroke-dasharray="2 4" stroke-linecap="round" />
        <ellipse cx="-5" cy="-6" rx="2.2" ry="3" fill="#2a120a" />
        <ellipse cx="5" cy="-6" rx="2.2" ry="3" fill="#2a120a" />
        <ellipse cx="0" cy="-1.5" rx="2.2" ry="2.6" fill="#2a120a" />
      </g>
      <path d="M52 34 l-10 -4 M54 44 l-12 0 M56 24 l-8 -6" stroke="#fff4dc" stroke-width="3" stroke-linecap="round" />
      <path d="M86 70 l3 -9 M92 68 l1 -6 M80 68 l-1 -7" stroke="#bfe3ff" stroke-width="3" stroke-linecap="round" />
    </svg>
  );
}
