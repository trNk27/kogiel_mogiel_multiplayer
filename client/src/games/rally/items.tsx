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
    bomb: (
      <>
        <circle cx="50" cy="56" r="34" fill="#9fcf5a" stroke={INK} stroke-width="4" />
        <path d="M50 22 Q34 40 36 88 M50 22 Q66 40 64 88 M18 52 Q50 44 82 52" fill="none" stroke="#5f9e2f" stroke-width="4" stroke-linecap="round" />
        <path d="M50 22 Q56 10 66 8" fill="none" stroke={INK} stroke-width="4" stroke-linecap="round" />
        <path d="M66 8 l6 -4 M66 8 l7 3 M66 8 l2 -7" stroke="#ff8a2a" stroke-width="4" stroke-linecap="round" />
      </>
    ),
    beet: (
      <>
        <path d="M14 58 Q8 40 24 42 Q22 22 40 30 Q50 14 60 30 Q80 22 76 44 Q94 46 86 62 Q96 78 76 78 Q70 94 54 84 Q40 96 32 80 Q12 82 14 58 Z" fill="#c2185b" stroke={INK} stroke-width="4" stroke-linejoin="round" />
        <circle cx="12" cy="30" r="5" fill="#c2185b" stroke={INK} stroke-width="3" />
        <circle cx="90" cy="26" r="4" fill="#c2185b" stroke={INK} stroke-width="3" />
        <ellipse cx="42" cy="50" rx="8" ry="5" fill="#f06292" />
      </>
    ),
    ghost: (
      <>
        <path d="M22 88 V46 Q22 14 50 14 Q78 14 78 46 V88 L68 80 L59 88 L50 80 L41 88 L32 80 Z" fill="#f4f0ff" fill-opacity="0.9" stroke={INK} stroke-width="4" stroke-linejoin="round" />
        <path d="M24 40 Q50 22 76 40 L74 30 Q50 6 26 30 Z" fill="#ff7ad1" stroke={INK} stroke-width="3" stroke-linejoin="round" />
        <circle cx="40" cy="52" r="5" fill={INK} />
        <circle cx="60" cy="52" r="5" fill={INK} />
        <ellipse cx="50" cy="68" rx="6" ry="8" fill={INK} />
      </>
    ),
    spray: (
      <>
        <path d="M30 40 H62 V86 Q62 92 56 92 H36 Q30 92 30 86 Z" fill="#c2185b" stroke={INK} stroke-width="4" stroke-linejoin="round" />
        <rect x="36" y="26" width="20" height="14" rx="3" fill="#fff4dc" stroke={INK} stroke-width="4" />
        <path d="M56 30 H70 L74 24" fill="none" stroke={INK} stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M36 54 H56" stroke="#f06292" stroke-width="4" stroke-linecap="round" />
        <circle cx="82" cy="18" r="5" fill="#c2185b" />
        <circle cx="90" cy="30" r="4" fill="#c2185b" />
        <circle cx="80" cy="34" r="3.5" fill="#c2185b" />
        <circle cx="92" cy="12" r="3" fill="#c2185b" />
      </>
    ),
    hay: (
      <>
        <rect x="12" y="34" width="76" height="48" rx="10" fill="#e9c25a" stroke={INK} stroke-width="4" />
        <path d="M20 46 H80 M20 58 H80 M20 70 H80" stroke="#b8902c" stroke-width="3" stroke-linecap="round" />
        <path d="M34 34 V82 M66 34 V82" stroke="#a5462e" stroke-width="5" />
        <path d="M14 34 l-6 -8 M22 34 l-2 -10 M86 34 l6 -8 M78 34 l2 -10" stroke="#e9c25a" stroke-width="3" stroke-linecap="round" />
      </>
    ),
  }[item];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      {art}
    </svg>
  );
}

/** Short labels for what just happened to a car. */
export function hitLabel(kind: RallyItem, blocked: boolean) {
  if (blocked) return 'BLOCKED!';
  switch (kind) {
    case 'butter':
      return 'SPLAT!';
    case 'pickle':
      return 'PICKLED!';
    case 'bomb':
      return 'KA-BOOM!';
    case 'beet':
      return 'BARSZCZ!';
    case 'hay':
      return 'BONK!';
    case 'spray':
      return 'SPRAYED!';
    default:
      return 'ZAP!';
  }
}
