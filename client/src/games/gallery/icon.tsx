/** Strzelnica: a night-time shooting gallery – awning, a ghost on a stick and a crosshair. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M14 14 H86 L90 32 H10 Z" fill="#fff4dc" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <path d="M22 14 L19 32 M38 14 L36 32 M54 14 L54 32 M70 14 L72 32 M86 14 L88 32" fill="none" stroke="#e8335a" stroke-width="8" />
      <path d="M10 32 q5 8 10 0 q5 8 10 0 q5 8 10 0 q5 8 10 0 q5 8 10 0 q5 8 10 0 q5 8 10 0 q5 8 10 0 q3 5 6 0" fill="#e8335a" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <circle cx="20" cy="40" r="2.6" fill="#ffd23f" />
      <circle cx="50" cy="42" r="2.6" fill="#ffd23f" />
      <circle cx="80" cy="40" r="2.6" fill="#ffd23f" />
      <rect x="47" y="70" width="6" height="16" fill="#d9a066" stroke="#2a120a" stroke-width="2.5" />
      <path d="M30 70 V54 Q30 40 44 40 Q58 40 58 54 V70 L53 66 L48 71 L43 66 L38 71 L33 66 Z" fill="#fff4dc" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" transform="translate(6 0)" />
      <ellipse cx="44" cy="54" rx="2.4" ry="3.4" fill="#2a120a" transform="translate(6 0)" />
      <ellipse cx="54" cy="54" rx="2.4" ry="3.4" fill="#2a120a" transform="translate(6 0)" />
      <ellipse cx="49.5" cy="62" rx="2.6" ry="3" fill="#2a120a" transform="translate(6 0)" />
      <path d="M8 88 H92" stroke="#8a5a34" stroke-width="8" stroke-linecap="round" />
      <g transform="translate(70 66)">
        <circle r="13" fill="rgba(58,20,32,.35)" stroke="#2a120a" stroke-width="8" />
        <circle r="13" fill="none" stroke="#ff3d6e" stroke-width="4.5" />
        <path d="M0 -20 V-8 M0 8 V20 M-20 0 H-8 M8 0 H20" stroke="#2a120a" stroke-width="7" stroke-linecap="round" />
        <path d="M0 -20 V-8 M0 8 V20 M-20 0 H-8 M8 0 H20" stroke="#ff3d6e" stroke-width="3.5" stroke-linecap="round" />
        <circle r="2.6" fill="#ff3d6e" />
      </g>
    </svg>
  );
}
