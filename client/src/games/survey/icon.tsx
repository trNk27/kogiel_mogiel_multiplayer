/** Ankieta: a clipboard with a yes/no tally. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <rect x="22" y="16" width="56" height="72" rx="8" fill="#fbf0d9" stroke="#2a120a" stroke-width="3" />
      <rect x="38" y="10" width="24" height="12" rx="4" fill="#b98a4a" stroke="#2a120a" stroke-width="3" />
      <rect x="30" y="34" width="12" height="12" rx="3" fill="#2fb07a" stroke="#2a120a" stroke-width="2.5" />
      <path d="M32.5 40 l3 3 l5 -6" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" />
      <rect x="48" y="37" width="22" height="6" rx="3" fill="#2a120a" opacity=".35" />
      <rect x="30" y="54" width="12" height="12" rx="3" fill="#e8335a" stroke="#2a120a" stroke-width="2.5" />
      <path d="M33 57 l6 6 M39 57 l-6 6" stroke="#fff" stroke-width="2.5" stroke-linecap="round" />
      <rect x="48" y="57" width="18" height="6" rx="3" fill="#2a120a" opacity=".35" />
      <text x="62" y="84" font-family="Georgia, serif" font-weight="900" font-size="20" fill="#e8335a">?%</text>
    </svg>
  );
}
