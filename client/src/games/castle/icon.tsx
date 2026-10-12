/** Obrona Wawelu: a castle tower with a red roof, and an arrow flying over it. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M8 96 V84 Q50 76 92 84 V96 Z" fill="#4a7d3b" />
      <path d="M26 88 V44 H74 V88 Z" fill="#b9ab92" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <path d="M22 44 V34 H30 V40 H38 V34 H46 V40 H54 V34 H62 V40 H70 V34 H78 V44 Z" fill="#cdbfa6" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <path d="M40 88 V72 Q50 62 60 72 V88 Z" fill="#5a3a1e" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <path d="M44 56 v8 M56 56 v8" stroke="#2a120a" stroke-width="4" stroke-linecap="round" />
      <path d="M34 34 L50 12 L66 34 Z" fill="#c2412d" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <circle cx="50" cy="12" r="3.5" fill="#ffc93c" stroke="#2a120a" stroke-width="2" />
      <g transform="rotate(-35 72 30)">
        <path d="M58 30 H90" stroke="#2a120a" stroke-width="6" stroke-linecap="round" />
        <path d="M58 30 H90" stroke="#e8d2a8" stroke-width="3" stroke-linecap="round" />
        <path d="M92 30 L84 25 L84 35 Z" fill="#c9ccd3" stroke="#2a120a" stroke-width="2" stroke-linejoin="round" />
        <path d="M58 30 L52 24 L62 30 L52 36 Z" fill="#ffd23f" stroke="#2a120a" stroke-width="1.5" stroke-linejoin="round" />
      </g>
    </svg>
  );
}
