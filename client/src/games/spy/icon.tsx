/** Szpieg: a pierogi in a fedora and dark glasses, with a secret card. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <g transform="translate(64 20) rotate(14)">
        <rect x="-13" y="-4" width="26" height="34" rx="4" fill="#fbf0d9" stroke="#2a120a" stroke-width="2.5" />
        <text x="0" y="21" text-anchor="middle" font-family="Georgia, serif" font-weight="900" font-size="22" fill="#e8335a">
          ?
        </text>
      </g>
      <ellipse cx="46" cy="84" rx="30" ry="4" fill="#000" opacity=".35" />
      <path d="M12 80 A34 34 0 0 1 80 80 Z" fill="#ffc93c" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <path d="M18 77 A28 28 0 0 1 74 77" fill="none" stroke="#d9a80a" stroke-width="2.5" stroke-dasharray="2 5" stroke-linecap="round" />
      <path d="M22 64 H70" stroke="#120a0c" stroke-width="3" />
      <rect x="22" y="60" width="19" height="11" rx="4" fill="#120a0c" />
      <rect x="51" y="60" width="19" height="11" rx="4" fill="#120a0c" />
      <ellipse cx="46" cy="46" rx="36" ry="6" fill="#2b2b33" stroke="#120a0c" stroke-width="2.5" />
      <path d="M28 46 Q28 22 46 23 Q64 22 64 46 Z" fill="#3b3b46" stroke="#120a0c" stroke-width="2.5" stroke-linejoin="round" />
      <path d="M29 39 Q46 44 63 39 L64 45 Q46 49 28 45 Z" fill="#e8335a" />
    </svg>
  );
}
