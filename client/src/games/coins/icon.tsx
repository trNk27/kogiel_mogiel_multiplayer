/** Grosze: coins raining onto a pierogi, with a flower pot waiting on a ledge. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M10 86 H90" stroke="#a3703a" stroke-width="5" stroke-linecap="round" />
      <g stroke="#2a120a" stroke-width="3">
        <circle cx="30" cy="22" r="9" fill="#ffcc2e" />
        <circle cx="68" cy="30" r="8" fill="#e4e9ee" />
        <circle cx="50" cy="14" r="6" fill="#d97a3f" />
        <circle cx="82" cy="12" r="5" fill="#d97a3f" />
      </g>
      <path d="M30 17 v10 M68 26 v8" stroke="#2a120a" stroke-width="2.5" stroke-linecap="round" opacity=".6" />
      <ellipse cx="50" cy="84" rx="18" ry="3.5" fill="#000" opacity=".35" />
      <g transform="translate(50 74)">
        <path d="M-19 0 A19 19 0 0 1 19 0 Z" fill="#ffd23f" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <path d="M-14 -2 A14 14 0 0 1 14 -2" fill="none" stroke="#d9a80a" stroke-width="2.5" stroke-dasharray="2 4" stroke-linecap="round" />
        <circle cx="-6" cy="-8" r="2.6" fill="#2a120a" />
        <circle cx="6" cy="-8" r="2.6" fill="#2a120a" />
        <path d="M-4 -3 Q0 0 4 -3" fill="none" stroke="#2a120a" stroke-width="2" stroke-linecap="round" />
      </g>
      <g stroke="#2a120a" stroke-width="2.5" stroke-linejoin="round">
        <path d="M8 46 h14 l-2 14 h-10 z" fill="#c8643a" />
        <path d="M13 46 c-2 -6 -6 -8 -3 -12 c3 3 4 4 6 4 c2 -4 4 -5 6 -4 c-1 5 -3 7 -5 12 z" fill="#4f8a2c" />
      </g>
    </svg>
  );
}
