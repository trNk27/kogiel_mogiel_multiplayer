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
  if (game === 'rally')
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
        <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
        <path d="M8 74 L92 74 L92 96 L8 96 Z" fill="#4c4a52" />
        <path d="M44 74 l6 0 l-1 22 l-6 0 Z" fill="#fff4dc" opacity=".7" />
        <path d="M18 66 L24 50 Q28 42 38 42 L60 42 Q70 42 74 50 L82 66 Z" fill="#ff3d6e" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <path d="M30 50 Q32 34 44 32 L56 32 Q68 34 70 50 Z" fill="#2b3d55" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <rect x="14" y="62" width="72" height="12" rx="5" fill="#ff3d6e" stroke="#2a120a" stroke-width="3" />
        <circle cx="30" cy="76" r="8" fill="#1d1a22" stroke="#c9ccd3" stroke-width="3" />
        <circle cx="70" cy="76" r="8" fill="#1d1a22" stroke="#c9ccd3" stroke-width="3" />
        <rect x="18" y="64" width="8" height="5" rx="2" fill="#fff4c8" />
        <rect x="74" y="64" width="8" height="5" rx="2" fill="#fff4c8" />
        <path d="M70 12 h18 v12 h-18 Z" fill="#fff4dc" />
        <path d="M70 12 h6 v6 h-6 Z M82 12 h6 v6 h-6 Z M76 18 h6 v6 h-6 Z" fill="#2a120a" />
      </svg>
    );
  if (game === 'bazgroly')
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
        <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
        <rect x="14" y="16" width="58" height="68" rx="6" fill="#fff4dc" stroke="#2a120a" stroke-width="3" transform="rotate(-6 43 50)" />
        <path d="M24 60 q6 -18 14 -6 t12 -2 q4 10 -6 12 q-14 2 -20 -4 Z" fill="none" stroke="#ff3d6e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="35" cy="40" r="3.5" fill="#2a120a" />
        <circle cx="47" cy="38" r="3.5" fill="#2a120a" />
        <text x="58" y="44" font-size="22" font-weight="700" fill="#4f9dff" font-family="Fredoka Variable, sans-serif">
          ?
        </text>
        <g transform="rotate(38 74 58)">
          <rect x="68" y="20" width="12" height="54" rx="2" fill="#ffd23f" stroke="#2a120a" stroke-width="3" />
          <rect x="68" y="20" width="12" height="9" rx="2" fill="#ff7ad1" stroke="#2a120a" stroke-width="3" />
          <path d="M68 74 L74 88 L80 74 Z" fill="#f1c46a" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
          <path d="M72.4 84 L74 88 L75.6 84 Z" fill="#2a120a" />
        </g>
      </svg>
    );
  if (game === 'toty')
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
        <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
        <rect x="16" y="30" width="68" height="50" rx="10" fill="#fff4dc" stroke="#2a120a" stroke-width="3" />
        <path d="M36 30 l5 -9 h18 l5 9 Z" fill="#fff4dc" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <circle cx="50" cy="55" r="17" fill="#4f9dff" stroke="#2a120a" stroke-width="3" />
        <circle cx="50" cy="55" r="8" fill="#2a120a" />
        <circle cx="54" cy="51" r="3" fill="#fff" />
        <circle cx="74" cy="39" r="3.5" fill="#ff3d6e" />
        <path d="M70 14 l3 6 l6 1 l-5 4 l1 6 l-5 -3 l-5 3 l1 -6 l-5 -4 l6 -1 Z" fill="#ffd23f" />
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
