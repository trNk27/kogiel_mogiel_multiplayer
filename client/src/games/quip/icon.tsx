/** Riposta: two speech bubbles trading blows, the winning one with a star. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M14 22 H58 Q66 22 66 30 V48 Q66 56 58 56 H38 L24 68 L26 56 H22 Q14 56 14 48 V30 Q14 22 22 22 Z" fill="#ff3d6e" stroke="#2a120a" stroke-width="3.5" stroke-linejoin="round" />
      <path d="M42 46 H86 Q94 46 94 54 V70 Q94 78 86 78 H80 L82 90 L66 78 H50 Q42 78 42 70 V54 Q42 46 50 46 Z" fill="#fbf0d9" stroke="#2a120a" stroke-width="3.5" stroke-linejoin="round" />
      <path d="M22 34 H56 M22 44 H44" stroke="#2a120a" stroke-width="4" stroke-linecap="round" />
      <path d="M52 58 H84 M52 67 H72" stroke="#2a120a" stroke-width="4" stroke-linecap="round" opacity=".75" />
      <path d="M78 10 L81 18 L89 18 L83 23 L85 31 L78 26 L71 31 L73 23 L67 18 L75 18 Z" fill="#ffd23f" stroke="#2a120a" stroke-width="2.5" stroke-linejoin="round" />
    </svg>
  );
}
