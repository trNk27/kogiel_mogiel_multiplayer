/** Wo ist der Pieróg?: a snowy market stall at night, with a pierogi peeking out from behind it. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#1b1446" />
      <circle cx="22" cy="20" r="1.8" fill="#fff" />
      <circle cx="70" cy="14" r="1.5" fill="#fff" />
      <circle cx="84" cy="30" r="1.8" fill="#fff" />
      <path d="M8 22 Q30 34 50 24 Q70 34 92 22" stroke="#2f7a4a" stroke-width="3" fill="none" />
      <circle cx="20" cy="28" r="3" fill="#ffd23f" />
      <circle cx="40" cy="29" r="3" fill="#ff5c8a" />
      <circle cx="60" cy="29" r="3" fill="#5ad0ff" />
      <circle cx="80" cy="28" r="3" fill="#ffd23f" />
      {/* The pierogi peeking out. */}
      <path d="M58 70 Q60 46 76 44 Q92 46 92 70 Z" fill="#f3cf6b" stroke="#2a120a" stroke-width="2.5" />
      <circle cx="72" cy="58" r="3" fill="#2a120a" />
      <circle cx="82" cy="58" r="3" fill="#2a120a" />
      <circle cx="71" cy="57" r="1" fill="#fff" />
      <circle cx="81" cy="57" r="1" fill="#fff" />
      {/* Stall. */}
      <rect x="14" y="56" width="52" height="34" rx="3" fill="#8a4b2a" stroke="#2a120a" stroke-width="2.5" />
      <rect x="20" y="62" width="40" height="13" rx="3" fill="#ffcf6b" stroke="#2a120a" stroke-width="2" />
      <path d="M8 58 L40 40 L72 58 Z" fill="#6e3a22" stroke="#2a120a" stroke-width="2.5" stroke-linejoin="round" />
      <path d="M12 56 Q26 48 40 44 Q54 48 68 56 Q54 60 40 56 Q26 60 12 56 Z" fill="#fffaf2" />
      <text x="40" y="73" font-size="11" text-anchor="middle">
        🍷
      </text>
    </svg>
  );
}
