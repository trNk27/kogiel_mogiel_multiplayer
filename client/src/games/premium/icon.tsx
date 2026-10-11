/** Maluch Rallye Premium's game icon: a gold Maluch under a trophy, on black and gold. */
export function Icon({ size = 80 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#1d1a22" />
      <rect x="8" y="8" width="84" height="84" rx="18" fill="none" stroke="#ffc93c" stroke-width="3" />
      <path d="M40 12 H60 V24 Q60 34 50 35 Q40 34 40 24 Z" fill="#ffc93c" stroke="#2a120a" stroke-width="2.5" stroke-linejoin="round" />
      <path d="M40 16 Q32 16 33 22 Q34 28 41 28 M60 16 Q68 16 67 22 Q66 28 59 28" fill="none" stroke="#ffc93c" stroke-width="2.5" />
      <rect x="44" y="35" width="12" height="5" rx="1.5" fill="#b5780a" />
      <path d="M8 78 L92 78 L92 92 L8 92 Z" fill="#4c4a52" />
      <path d="M8 78 h10 v7 h-10 Z M28 78 h10 v7 h-10 Z M48 78 h10 v7 h-10 Z M68 78 h10 v7 h-10 Z M18 85 h10 v7 h-10 Z M38 85 h10 v7 h-10 Z M58 85 h10 v7 h-10 Z M78 85 h10 v7 h-10 Z" fill="#fff4dc" opacity=".55" />
      <path d="M18 72 L24 58 Q28 50 38 50 L60 50 Q70 50 74 58 L82 72 Z" fill="#ffc93c" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <path d="M30 58 Q32 46 44 44 L56 44 Q68 46 70 58 Z" fill="#2b3d55" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <rect x="14" y="68" width="72" height="11" rx="5" fill="#ffc93c" stroke="#2a120a" stroke-width="3" />
      <circle cx="30" cy="80" r="7.5" fill="#1d1a22" stroke="#c9ccd3" stroke-width="3" />
      <circle cx="70" cy="80" r="7.5" fill="#1d1a22" stroke="#c9ccd3" stroke-width="3" />
      <path d="M36 52 Q40 48 46 48" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="2.5" stroke-linecap="round" />
      <path d="M12 40 l3 -3 l3 3 l-3 3 Z M84 34 l3 -3 l3 3 l-3 3 Z M20 22 l2 -2 l2 2 l-2 2 Z" fill="#fff1b0" />
    </svg>
  );
}
