/** Przystań: a little motorboat sliding into a berth painted on the water, a flag on the pier. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#1f6f8f" />
      <path d="M10 70 Q20 66 30 70 T50 70 T70 70 T90 70" fill="none" stroke="#7fd0e4" stroke-width="3" stroke-linecap="round" />
      <path d="M10 84 Q20 80 30 84 T50 84 T70 84 T90 84" fill="none" stroke="#5bb6cf" stroke-width="3" stroke-linecap="round" />
      <rect x="8" y="10" width="84" height="12" rx="3" fill="#c9b89c" stroke="#2a120a" stroke-width="3" />
      <rect x="50" y="20" width="34" height="46" rx="3" fill="none" stroke="#ffd23f" stroke-width="4" stroke-dasharray="7 5" />
      <path d="M78 22 V6" stroke="#f4efe4" stroke-width="3" />
      <path d="M78 6 L92 10 L78 14 Z" fill="#ffd23f" stroke="#2a120a" stroke-width="2" stroke-linejoin="round" />
      <g transform="translate(58 30) rotate(-14)">
        <path d="M0 6 Q0 -4 8 -10 Q16 -4 16 6 V34 H0 Z" fill="#e8335a" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <rect x="3" y="12" width="10" height="8" rx="2" fill="#fbf6ec" stroke="#2a120a" stroke-width="2" />
        <path d="M5 34 V39 H11 V34" fill="#3b3f48" stroke="#2a120a" stroke-width="2" />
      </g>
      <path d="M40 74 l-8 10 M48 76 l2 10 M56 75 l9 8" stroke="#f4fbff" stroke-width="3" stroke-linecap="round" />
      <path d="M22 54 Q30 48 36 52" fill="none" stroke="#f4fbff" stroke-width="3" stroke-linecap="round" />
    </svg>
  );
}
