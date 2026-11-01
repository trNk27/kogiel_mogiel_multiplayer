/** Słownik: an open dictionary with a made-up word and a question mark. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M50 28 Q32 20 14 26 L14 78 Q32 72 50 80 Z" fill="#fbf0d9" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <path d="M50 28 Q68 20 86 26 L86 78 Q68 72 50 80 Z" fill="#f3e2bf" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <path d="M50 28 L50 80" stroke="#2a120a" stroke-width="3" />
      <rect x="20" y="34" width="24" height="6" rx="2" fill="#e8335a" />
      <rect x="20" y="45" width="22" height="3.5" rx="1.5" fill="#2a120a" opacity=".4" />
      <rect x="20" y="52" width="18" height="3.5" rx="1.5" fill="#2a120a" opacity=".4" />
      <rect x="20" y="59" width="21" height="3.5" rx="1.5" fill="#2a120a" opacity=".4" />
      <text x="68" y="64" text-anchor="middle" font-family="Georgia, serif" font-weight="900" font-size="34" fill="#ffc93c" stroke="#2a120a" stroke-width="1.5">?</text>
    </svg>
  );
}
