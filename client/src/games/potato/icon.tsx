/** Gorący Ziemniak: a glowing, steaming hot potato over a pierogi's head. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <circle cx="50" cy="40" r="30" fill="#ff5a1a" opacity=".22" />
      <path d="M36 22 q-4 -7 1 -12 M50 20 q4 -7 -1 -12 M64 22 q5 -6 1 -12" fill="none" stroke="#fff4dc" stroke-width="4" stroke-linecap="round" opacity=".85" />
      <path d="M26 42 C24 30 38 25 50 27 C63 29 74 33 73 44 C72 54 60 58 49 57 C37 56 27 53 26 42 Z" fill="#ff7a3a" stroke="#2a120a" stroke-width="3.5" />
      <circle cx="40" cy="39" r="2.2" fill="#8a3a1a" />
      <circle cx="56" cy="36" r="2.2" fill="#8a3a1a" />
      <circle cx="61" cy="48" r="2" fill="#8a3a1a" />
      <ellipse cx="50" cy="88" rx="22" ry="3.5" fill="#000" opacity=".35" />
      <g transform="translate(50 86)">
        <path d="M-24 0 A24 24 0 0 1 24 0 Z" fill="#a3e048" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <path d="M-19 -2 A19 19 0 0 1 19 -2" fill="none" stroke="#6fa82a" stroke-width="2.5" stroke-dasharray="2 4" stroke-linecap="round" />
        <circle cx="-7" cy="-11" r="3" fill="#fff8ea" />
        <circle cx="7" cy="-11" r="3" fill="#fff8ea" />
        <circle cx="-7" cy="-10" r="1.6" fill="#2a120a" />
        <circle cx="7" cy="-10" r="1.6" fill="#2a120a" />
      </g>
    </svg>
  );
}
