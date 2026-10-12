/** Skakanka: a pierogi jumping over a swinging kiełbasa rope. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M10 86 H90" stroke="#a3e048" stroke-width="5" stroke-linecap="round" />
      <path d="M12 40 Q50 104 88 40" fill="none" stroke="#2a120a" stroke-width="11" stroke-linecap="round" />
      <path d="M12 40 Q50 104 88 40" fill="none" stroke="#b5482e" stroke-width="7" stroke-linecap="round" stroke-dasharray="11 3" />
      <ellipse cx="50" cy="83" rx="14" ry="3" fill="#000" opacity=".35" />
      <g transform="translate(50 52)">
        <path d="M-17 0 A17 17 0 0 1 17 0 Z" fill="#ffd23f" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <path d="M-13 -2 A13 13 0 0 1 13 -2" fill="none" stroke="#d9a80a" stroke-width="2.5" stroke-dasharray="2 4" stroke-linecap="round" />
        <circle cx="-5" cy="-7" r="2.4" fill="#2a120a" />
        <circle cx="5" cy="-7" r="2.4" fill="#2a120a" />
      </g>
      <path d="M38 62 l-4 6 M50 63 v7 M62 62 l4 6" stroke="#fff4dc" stroke-width="3" stroke-linecap="round" opacity=".75" />
      <circle cx="12" cy="40" r="6" fill="#f4d9b5" stroke="#2a120a" stroke-width="2.5" />
      <circle cx="88" cy="40" r="6" fill="#f4d9b5" stroke="#2a120a" stroke-width="2.5" />
    </svg>
  );
}
