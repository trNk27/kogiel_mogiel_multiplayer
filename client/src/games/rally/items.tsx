import type { RallyItem } from '../../../../shared/protocol';

const INK = '#2a120a';

/** Hand-drawn item icons, shared by the TV and the phones. */
export function ItemIcon({ item, size = 64 }: { item: RallyItem; size?: number }) {
  const art = {
    boost: (
      <>
        <rect x="26" y="22" width="48" height="62" rx="12" fill="#ff7ad1" stroke={INK} stroke-width="4" />
        <rect x="30" y="14" width="40" height="12" rx="4" fill="#ffd23f" stroke={INK} stroke-width="4" />
        <path d="M54 32 L38 58 H50 L44 78 L64 48 H52 Z" fill="#fff4dc" stroke={INK} stroke-width="3" stroke-linejoin="round" />
      </>
    ),
    butter: (
      <>
        <ellipse cx="50" cy="70" rx="40" ry="14" fill="#ffe27a" stroke={INK} stroke-width="4" />
        <path d="M24 60 L34 36 H78 L72 60 Z" fill="#fff1b0" stroke={INK} stroke-width="4" stroke-linejoin="round" />
        <path d="M34 36 L44 26 H86 L78 36" fill="#fff8d6" stroke={INK} stroke-width="4" stroke-linejoin="round" />
        <path d="M78 36 L86 26 L82 50 L72 60" fill="#f5df8c" stroke={INK} stroke-width="4" stroke-linejoin="round" />
      </>
    ),
    pickle: (
      <>
        <path d="M18 70 Q14 50 34 36 Q58 20 78 22 Q90 24 84 38 Q76 56 52 70 Q32 82 18 70 Z" fill="#6fae38" stroke={INK} stroke-width="4" />
        <circle cx="40" cy="54" r="3" fill="#3f7a1e" />
        <circle cx="56" cy="44" r="3" fill="#3f7a1e" />
        <circle cx="68" cy="34" r="3" fill="#3f7a1e" />
        <path d="M6 82 L18 74 M10 90 L22 78" stroke="#ff8a2a" stroke-width="5" stroke-linecap="round" />
      </>
    ),
    lid: (
      <>
        <ellipse cx="50" cy="60" rx="40" ry="20" fill="#c9ccd3" stroke={INK} stroke-width="4" />
        <ellipse cx="50" cy="56" rx="30" ry="12" fill="#e3e6eb" />
        <rect x="40" y="30" width="20" height="16" rx="6" fill="#6b4428" stroke={INK} stroke-width="4" />
        <path d="M22 44 Q50 20 78 44" fill="none" stroke="#4f9dff" stroke-width="4" stroke-dasharray="6 6" />
      </>
    ),
    storm: (
      <>
        <path d="M22 54 Q10 54 12 42 Q14 30 28 32 Q32 16 50 18 Q66 18 70 32 Q88 30 88 44 Q88 56 74 56 Z" fill="#6c6880" stroke={INK} stroke-width="4" stroke-linejoin="round" />
        <path d="M52 52 L40 72 H50 L44 92 L64 64 H54 L60 52 Z" fill="#ffd23f" stroke={INK} stroke-width="3" stroke-linejoin="round" />
      </>
    ),
    rocket: (
      <>
        <path d="M50 8 Q70 26 68 60 H32 Q30 26 50 8 Z" fill="#ff3d6e" stroke={INK} stroke-width="4" stroke-linejoin="round" />
        <circle cx="50" cy="36" r="8" fill="#4f9dff" stroke={INK} stroke-width="3" />
        <path d="M32 50 L18 70 L32 66 Z M68 50 L82 70 L68 66 Z" fill="#ffd23f" stroke={INK} stroke-width="3" stroke-linejoin="round" />
        <path d="M38 62 Q50 96 62 62 Z" fill="#ff8a2a" stroke={INK} stroke-width="3" stroke-linejoin="round" />
      </>
    ),
  }[item];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      {art}
    </svg>
  );
}
