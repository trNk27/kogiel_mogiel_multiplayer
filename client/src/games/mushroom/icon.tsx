/** Grzybki: a fly agaric on a pond. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <clipPath id="mush-icon-clip">
          <rect x="4" y="4" width="92" height="92" rx="22" />
        </clipPath>
      </defs>
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <g clip-path="url(#mush-icon-clip)">
        <path d="M0 74 q11 -7 22 0 t22 0 t22 0 t22 0 t22 0 V100 H0 Z" fill="#4f9dff" />
        <path d="M0 82 q11 -6 22 0 t22 0 t22 0 t22 0 t22 0" fill="none" stroke="#fff4dc" stroke-width="2.4" stroke-linecap="round" opacity=".55" />
        <ellipse cx="50" cy="80" rx="30" ry="6" fill="none" stroke="#fff4dc" stroke-width="2.6" opacity=".7" />
      </g>
      <path d="M40 54 Q39 70 35 80 L65 80 Q61 70 60 54 Z" fill="#fff4dc" stroke="#2a120a" stroke-width="3.4" stroke-linejoin="round" />
      <path d="M12 56 Q12 18 50 17 Q88 18 88 56 Q50 66 12 56 Z" fill="#e8335a" stroke="#2a120a" stroke-width="3.6" stroke-linejoin="round" />
      <g fill="#fff4dc" stroke="#2a120a" stroke-width="1.6">
        <circle cx="31" cy="40" r="6.2" />
        <circle cx="53" cy="29" r="5.2" />
        <circle cx="70" cy="44" r="6.4" />
        <circle cx="48" cy="48" r="4" />
        <circle cx="78" cy="33" r="3" />
      </g>
      <circle cx="18" cy="22" r="2.2" fill="#ffc93c" />
      <circle cx="84" cy="20" r="2.2" fill="#ffc93c" />
    </svg>
  );
}
