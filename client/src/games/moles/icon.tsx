/** Krety: a red-nosed mole peeking out of a molehill, a wooden spoon coming down on it. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M10 88 H90" stroke="#7fbf3f" stroke-width="5" stroke-linecap="round" />
      <path d="M38 50 Q38 30 52 30 Q66 30 66 50 V72 H38 Z" fill="#2d2630" stroke="#120a0c" stroke-width="3" stroke-linejoin="round" />
      <circle cx="46" cy="44" r="5" fill="#fff8ea" />
      <circle cx="58" cy="44" r="5" fill="#fff8ea" />
      <circle cx="47.5" cy="45" r="2.3" fill="#1d0f0a" />
      <circle cx="56.5" cy="45" r="2.3" fill="#1d0f0a" />
      <circle cx="52" cy="54" r="5" fill="#e0322a" stroke="#120a0c" stroke-width="2" />
      <path d="M18 88 Q22 66 52 66 Q82 66 86 88 Z" fill="#7a5232" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <ellipse cx="52" cy="70" rx="16" ry="4" fill="#1e120a" />
      <g transform="rotate(-38 76 34)">
        <rect x="73" y="26" width="6" height="40" rx="3" fill="#d7a065" stroke="#2a120a" stroke-width="2.5" />
        <ellipse cx="76" cy="20" rx="10" ry="13" fill="#d7a065" stroke="#2a120a" stroke-width="2.5" />
        <ellipse cx="76" cy="20" rx="6" ry="8.5" fill="#b07a42" />
      </g>
      <path d="M30 26 l3 6 6 1 -5 4 1 6 -5 -3 -5 3 1 -6 -5 -4 6 -1 Z" fill="#ffe14a" stroke="#2a120a" stroke-width="1.5" stroke-linejoin="round" />
    </svg>
  );
}
