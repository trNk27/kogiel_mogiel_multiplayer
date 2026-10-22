/** Korona: a golden crown flying off a pierogi's head, with a dash streak. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M8 84 H92" stroke="#c9b48a" stroke-width="4" stroke-linecap="round" opacity=".7" />
      <ellipse cx="44" cy="82" rx="16" ry="3.5" fill="#000" opacity=".35" />
      <g transform="translate(44 80)">
        <path d="M-20 0 A20 20 0 0 1 20 0 Z" fill="#ff7a8a" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <path d="M-15 -2 A15 15 0 0 1 15 -2" fill="none" stroke="#c94a5c" stroke-width="2.5" stroke-dasharray="2 4" stroke-linecap="round" />
        <circle cx="-6" cy="-9" r="2.6" fill="#2a120a" />
        <circle cx="6" cy="-9" r="2.6" fill="#2a120a" />
      </g>
      <path d="M12 64 h14 M8 72 h12" stroke="#fff4dc" stroke-width="3.5" stroke-linecap="round" opacity=".6" />
      <g transform="translate(62 34) rotate(18)">
        <path d="M-17 10 L-19 -8 L-9 0 L0 -14 L9 0 L19 -8 L17 10 Z" fill="#ffc93c" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <circle cx="0" cy="4" r="3" fill="#e8233a" />
        <circle cx="-10" cy="5" r="2" fill="#3a6ee8" />
        <circle cx="10" cy="5" r="2" fill="#3a6ee8" />
      </g>
      <path d="M76 16 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 Z" fill="#fff4b0" />
      <path d="M40 22 l1.5 3.5 l3.5 1.5 l-3.5 1.5 l-1.5 3.5 l-1.5 -3.5 l-3.5 -1.5 l3.5 -1.5 Z" fill="#fff4b0" opacity=".8" />
      <path d="M48 58 q6 -10 10 -14" fill="none" stroke="#ffc93c" stroke-width="2.5" stroke-dasharray="3 4" stroke-linecap="round" />
    </svg>
  );
}
