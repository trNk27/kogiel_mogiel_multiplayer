/** Babcia’s Cookbook: a page swinging over with holes cut in it, and a pierogi standing in a lit patch below. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M10 76 L50 90 L90 76 L90 84 L50 98 L10 84 Z" fill="#c4254a" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <path d="M50 88 L90 76 L90 54 L50 64 Z" fill="#fff4dc" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <path d="M50 88 L10 76 L10 56 L50 64 Z" fill="#f6e3bd" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <ellipse cx="72" cy="72" rx="13" ry="7" fill="#ffd23f" opacity=".85" />
      <path d="M60 76 L84 69" stroke="#e0b94a" stroke-width="2" stroke-linecap="round" />
      <path d="M50 88 L50 52 L12 20 L12 56 Z" fill="#fff4dc" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <circle cx="28" cy="46" r="6.5" fill="#3a1420" stroke="#2a120a" stroke-width="2.5" />
      <path d="M21.0 27.5 L22.4 31.1 L26.2 31.3 L23.3 33.7 L24.2 37.4 L21.0 35.4 L17.8 37.4 L18.7 33.7 L15.8 31.3 L19.6 31.1 Z" fill="#3a1420" />
      <g transform="translate(72 70)">
        <path d="M-12 0 A12 12 0 0 1 12 0 Z" fill="#ff3d6e" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <path d="M-9 -2 A9 9 0 0 1 9 -2" fill="none" stroke="#c42a52" stroke-width="2.5" stroke-dasharray="2 4" stroke-linecap="round" />
        <circle cx="-4" cy="-5" r="2" fill="#2a120a" />
        <circle cx="4" cy="-5" r="2" fill="#2a120a" />
      </g>
      <path d="M26 14 l-4 -6 M36 12 l0 -7 M46 16 l4 -6" stroke="#fff4dc" stroke-width="3" stroke-linecap="round" opacity=".8" />
    </svg>
  );
}
