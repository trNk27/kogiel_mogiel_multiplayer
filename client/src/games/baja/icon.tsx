/** Wybredna Baja: Baja's ginger face with her white blaze, peeking out of her blanket, and a drumstick. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#5a5553" />
      <path d="M26 44 L20 14 L42 30 Z" fill="#c9772f" stroke="#2a120a" stroke-width="2.5" stroke-linejoin="round" />
      <path d="M74 44 L80 14 L58 30 Z" fill="#c9772f" stroke="#2a120a" stroke-width="2.5" stroke-linejoin="round" />
      <ellipse cx="50" cy="52" rx="28" ry="26" fill="#c9772f" stroke="#2a120a" stroke-width="2.5" />
      <path d="M47 27 Q50 26 53 27 Q56 46 66 60 Q62 74 50 76 Q38 74 34 60 Q44 46 47 27 Z" fill="#f8f1e6" />
      <circle cx="39" cy="50" r="6" fill="#1a0905" />
      <circle cx="61" cy="51" r="6" fill="#1a0905" />
      <circle cx="37" cy="48" r="2" fill="#fff" />
      <circle cx="59" cy="49" r="2" fill="#fff" />
      <ellipse cx="50" cy="62" rx="6" ry="4" fill="#6b3a32" />
      <path d="M8 96 L8 74 Q20 62 32 70 Q42 80 50 80 Q58 80 68 70 Q80 62 92 74 L92 96 Z" fill="#efe5d3" stroke="#2a120a" stroke-width="2.5" />
      <circle cx="22" cy="84" r="4" fill="none" stroke="#d6c7ad" stroke-width="2" />
      <circle cx="78" cy="84" r="4" fill="none" stroke="#d6c7ad" stroke-width="2" />
      <circle cx="50" cy="90" r="4" fill="none" stroke="#d6c7ad" stroke-width="2" />
      <g transform="rotate(30 80 30)">
        <ellipse cx="80" cy="26" rx="9" ry="7" fill="#d9893f" stroke="#2a120a" stroke-width="2" />
        <rect x="78" y="31" width="4" height="10" rx="2" fill="#fbf0d9" stroke="#2a120a" stroke-width="1.5" />
      </g>
    </svg>
  );
}
