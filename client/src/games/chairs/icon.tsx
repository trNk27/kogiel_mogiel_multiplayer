/** Krzesła: a pierogi sitting on a wooden chair while the band plays. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M8 86 H92" stroke="#c9b48a" stroke-width="4" stroke-linecap="round" opacity=".7" />
      <ellipse cx="42" cy="86" rx="24" ry="3.5" fill="#000" opacity=".35" />
      <g stroke="#2a120a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
        <path d="M24 84 V56 M60 84 V60" fill="none" stroke-width="5" />
        <path d="M24 56 V30 H34 V56" fill="#c98a4a" stroke-width="3" />
        <rect x="20" y="52" width="46" height="9" rx="3" fill="#e0a45a" />
      </g>
      <g transform="translate(46 49)">
        <path d="M-17 0 A17 17 0 0 1 17 0 Z" fill="#ff7a8a" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <path d="M-12 -2 A12 12 0 0 1 12 -2" fill="none" stroke="#c94a5c" stroke-width="2.5" stroke-dasharray="2 4" stroke-linecap="round" />
        <circle cx="-5" cy="-7" r="2.4" fill="#2a120a" />
        <circle cx="5" cy="-7" r="2.4" fill="#2a120a" />
        <path d="M-3 -2 Q0 1 3 -2" fill="none" stroke="#2a120a" stroke-width="2" stroke-linecap="round" />
      </g>
      <g fill="#ffd23f" stroke="#2a120a" stroke-width="2">
        <path d="M74 22 v-12 l12 -3 v12" fill="none" stroke-width="3" stroke-linecap="round" />
        <ellipse cx="72" cy="23" rx="4.5" ry="3.5" />
        <ellipse cx="84" cy="20" rx="4.5" ry="3.5" />
      </g>
      <path d="M72 62 q8 -6 14 0 M74 70 q6 -4 10 0" fill="none" stroke="#fff4dc" stroke-width="3" stroke-linecap="round" opacity=".6" />
    </svg>
  );
}
