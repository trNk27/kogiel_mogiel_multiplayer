/** Babcia Mówi: Babcia in her headscarf raising the red flag, the white one down. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M8 84 Q50 76 92 84 V92 Q50 86 8 92 Z" fill="#4f9dff" opacity=".7" />
      <path d="M72 70 L82 18" stroke="#7a4e28" stroke-width="4" stroke-linecap="round" />
      <path d="M81 20 L96 24 L92 40 L78 36 Z" fill="#dc143c" stroke="#2a120a" stroke-width="2.5" stroke-linejoin="round" />
      <path d="M28 70 L12 86" stroke="#7a4e28" stroke-width="4" stroke-linecap="round" />
      <path d="M13 85 L4 76 L12 66 L20 76 Z" fill="#fbf6ec" stroke="#2a120a" stroke-width="2.5" stroke-linejoin="round" />
      <g transform="translate(50 74)">
        <path d="M-27 0 A27 27 0 0 1 27 0 Z" fill="#f4d9b5" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <path d="M-25 -8 A26 26 0 0 1 25 -8 L20 -14 A21 21 0 0 0 -20 -14 Z" fill="#cf3a2c" />
        <path d="M-24 -10 A25 25 0 0 1 0 -26 A25 25 0 0 1 24 -10" fill="none" stroke="#cf3a2c" stroke-width="7" />
        <circle cx="-9" cy="-12" r="4.5" fill="none" stroke="#7a5a2a" stroke-width="2" />
        <circle cx="9" cy="-12" r="4.5" fill="none" stroke="#7a5a2a" stroke-width="2" />
        <circle cx="-9" cy="-12" r="1.8" fill="#2a120a" />
        <circle cx="9" cy="-12" r="1.8" fill="#2a120a" />
        <path d="M-6 -4 Q0 1 6 -4" fill="none" stroke="#2a120a" stroke-width="2.5" stroke-linecap="round" />
      </g>
      <path d="M30 22 q10 -10 26 -4" fill="none" stroke="#fff4dc" stroke-width="3" stroke-linecap="round" opacity=".7" />
      <text x="40" y="20" font-size="15" font-weight="700" fill="#ffd23f" font-family="Fraunces Variable, Georgia, serif">!</text>
    </svg>
  );
}
