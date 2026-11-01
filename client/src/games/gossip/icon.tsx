/** Plotki: two speech bubbles whispering, one with a gasp. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M14 22 h44 a8 8 0 0 1 8 8 v18 a8 8 0 0 1 -8 8 h-26 l-10 10 v-10 h-8 a8 8 0 0 1 -8 -8 v-18 a8 8 0 0 1 8 -8 z" fill="#fbf0d9" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <circle cx="26" cy="39" r="3.5" fill="#2a120a" />
      <circle cx="36" cy="39" r="3.5" fill="#2a120a" />
      <circle cx="46" cy="39" r="3.5" fill="#2a120a" />
      <path d="M44 50 h38 a8 8 0 0 1 8 8 v14 a8 8 0 0 1 -8 8 h-4 v9 l-10 -9 h-24 a8 8 0 0 1 -8 -8 v-14 a8 8 0 0 1 8 -8 z" fill="#ff7aa8" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <text x="63" y="74" text-anchor="middle" font-family="Georgia, serif" font-weight="900" font-size="20" fill="#2a120a">!?</text>
    </svg>
  );
}
