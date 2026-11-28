/** Spacer z Bają: a green exit sign over a little street, with Baja trotting the other way. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="sp-ic-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2a1d48" />
          <stop offset="1" stop-color="#c4697a" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="92" height="92" rx="22" fill="url(#sp-ic-sky)" />
      <rect x="12" y="34" width="30" height="44" fill="#8a4b3b" />
      <rect x="58" y="28" width="30" height="50" fill="#2f6f6a" />
      <rect x="17" y="40" width="8" height="9" fill="#ffd27a" />
      <rect x="29" y="40" width="8" height="9" fill="#ffd27a" />
      <rect x="63" y="36" width="8" height="9" fill="#ffd27a" />
      <rect x="75" y="36" width="8" height="9" fill="#2b2433" />
      <rect x="4" y="78" width="92" height="18" fill="#5a5562" />
      <path
        d="M46 78 V44 q0 -6 6 -6"
        stroke="#2a2530"
        stroke-width="3"
        fill="none"
      />
      <circle cx="54" cy="39" r="3" fill="#fff2c4" />
      <rect
        x="22"
        y="10"
        width="56"
        height="20"
        rx="4"
        fill="#1f8a4c"
        stroke="#d8ffe4"
        stroke-width="2.5"
      />
      <text
        x="50"
        y="25"
        text-anchor="middle"
        font-size="14"
        font-weight="900"
        fill="#fff"
        font-family="system-ui, sans-serif"
      >
        EXIT 8
      </text>
      <g transform="translate(48 66)">
        <ellipse cx="14" cy="12" rx="14" ry="9" fill="#e8913a" />
        <circle cx="3" cy="5" r="8" fill="#e8913a" />
        <path d="M-2 0 l-2 -8 l6 5 Z M6 -1 l3 -8 l2 8 Z" fill="#c56a22" />
        <circle cx="1" cy="4" r="1.6" fill="#1a0905" />
        <ellipse cx="-4" cy="7" rx="2" ry="1.5" fill="#2a120a" />
        <path
          d="M27 9 q8 -10 4 -16"
          stroke="#e8913a"
          stroke-width="5"
          fill="none"
          stroke-linecap="round"
        />
        <path
          d="M6 20 v5 M20 20 v5"
          stroke="#e8913a"
          stroke-width="3.5"
          stroke-linecap="round"
        />
      </g>
      <g fill="#fff">
        <circle cx="20" cy="20" r="1.5" />
        <circle cx="86" cy="16" r="1.5" />
        <circle cx="14" cy="62" r="1.5" />
        <circle cx="90" cy="54" r="1.5" />
      </g>
    </svg>
  );
}
