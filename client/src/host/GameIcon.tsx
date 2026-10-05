import type { GameId } from '../../../shared/protocol';

/** Illustrated icons for the games. */
export function GameIcon({ game, size = 80 }: { game: GameId; size?: number }) {
  if (game === 'trails')
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
        <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
        <path d="M14 76 C 30 76, 30 40, 50 40 S 72 70, 86 30" fill="none" stroke="#ff3d6e" stroke-width="7" stroke-linecap="round" stroke-dasharray="40 8 200" />
        <path d="M14 30 C 34 24, 44 74, 62 70 S 80 56, 86 74" fill="none" stroke="#ffd23f" stroke-width="7" stroke-linecap="round" />
        <circle cx="86" cy="30" r="7" fill="#fff4dc" />
        <circle cx="86" cy="74" r="7" fill="#fff4dc" />
      </svg>
    );
  if (game === 'quiz')
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
        <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
        <rect x="14" y="14" width="33" height="33" rx="8" fill="#e8335a" />
        <rect x="53" y="14" width="33" height="33" rx="8" fill="#3d7eff" />
        <rect x="14" y="53" width="33" height="33" rx="8" fill="#f2b705" />
        <rect x="53" y="53" width="33" height="33" rx="8" fill="#4caf50" />
        <text x="50" y="66" text-anchor="middle" font-size="46" font-weight="700" fill="#fff4dc" font-family="Fredoka Variable, sans-serif" stroke="#2a120a" stroke-width="3" paint-order="stroke">
          ?
        </text>
      </svg>
    );
  if (game === 'kitchen')
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
        <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
        <path d="M30 18 q8 -8 0 -14 M50 18 q8 -8 0 -14 M70 18 q8 -8 0 -14" fill="none" stroke="rgba(255,244,220,.55)" stroke-width="4" stroke-linecap="round" transform="translate(0 10)" />
        <path d="M14 46 H86 L80 82 Q50 92 20 82 Z" fill="#c9ccd3" stroke="#6f7787" stroke-width="4" stroke-linejoin="round" />
        <rect x="8" y="42" width="84" height="9" rx="4.5" fill="#e3e6eb" stroke="#6f7787" stroke-width="3" />
        <path d="M30 48 Q30 34 42 34 Q54 34 54 48 Z M48 48 Q48 30 62 30 Q76 30 76 48 Z" fill="#f1c46a" stroke="#b5842c" stroke-width="3" stroke-linejoin="round" />
        <circle cx="50" cy="66" r="5" fill="#2f5fae" />
        <circle cx="34" cy="66" r="3.5" fill="#2f5fae" />
        <circle cx="66" cy="66" r="3.5" fill="#2f5fae" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <circle cx="50" cy="54" r="34" fill="#fff4dc" />
      <circle cx="50" cy="54" r="24" fill="#ff8a2a" />
      <circle cx="50" cy="54" r="14" fill="#fff4dc" />
      <circle cx="50" cy="54" r="6" fill="#e8335a" />
      <path d="M50 54 L82 16" stroke="#2fd6a8" stroke-width="5" stroke-linecap="round" />
      <path d="M82 16 l-12 2 M82 16 l-2 12" stroke="#2fd6a8" stroke-width="5" stroke-linecap="round" />
    </svg>
  );
}
