/** Krówki: a cow with a patch, and a lasso loop over it. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <rect x="8" y="78" width="84" height="14" rx="6" fill="#5e9a3c" />
      <rect x="26" y="68" width="8" height="16" rx="2" fill="#f6f1e4" stroke="#2a120a" stroke-width="2.5" />
      <rect x="56" y="68" width="8" height="16" rx="2" fill="#f6f1e4" stroke="#2a120a" stroke-width="2.5" />
      <rect x="18" y="44" width="52" height="30" rx="9" fill="#f6f1e4" stroke="#2a120a" stroke-width="3" />
      <path d="M30 46 q10 -2 12 8 q-2 10 -14 8 q-6 -8 2 -16 Z" fill="#ff3d6e" />
      <path d="M58 60 q8 0 10 6 l-12 4 Z" fill="#ff3d6e" />
      <rect x="62" y="34" width="26" height="24" rx="7" fill="#f6f1e4" stroke="#2a120a" stroke-width="3" />
      <rect x="66" y="48" width="22" height="12" rx="5" fill="#f2a5a0" stroke="#2a120a" stroke-width="2.5" />
      <circle cx="70" cy="42" r="2.6" fill="#2a120a" />
      <circle cx="81" cy="42" r="2.6" fill="#2a120a" />
      <path d="M64 34 l-4 -6 M86 34 l4 -6" stroke="#efe0b8" stroke-width="4" stroke-linecap="round" />
      <ellipse cx="74" cy="22" rx="16" ry="6" fill="none" stroke="#ffd23f" stroke-width="4" />
      <path d="M60 24 Q40 30 30 18 Q22 10 12 16" fill="none" stroke="#ffd23f" stroke-width="4" stroke-linecap="round" />
    </svg>
  );
}
