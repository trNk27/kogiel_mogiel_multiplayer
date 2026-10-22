/** Minutnik: a tomato kitchen timer with its dial. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <ellipse cx="50" cy="88" rx="30" ry="4" fill="#000" opacity=".35" />
      <ellipse cx="50" cy="58" rx="34" ry="30" fill="#d8322a" stroke="#2a120a" stroke-width="3.5" />
      <path d="M50 30 l-12 -6 l8 10 l-14 2 l14 3 M50 30 l12 -6 l-8 10 l14 2 l-14 3" fill="#3f8a2a" stroke="#2a120a" stroke-width="2.5" stroke-linejoin="round" />
      <rect x="47" y="18" width="6" height="12" rx="2" fill="#3f8a2a" stroke="#2a120a" stroke-width="2.5" />
      <circle cx="50" cy="61" r="19" fill="#fbf3dc" stroke="#2a120a" stroke-width="3" />
      <path d="M50 44 v4 M67 61 h-4 M50 78 v-4 M33 61 h4" stroke="#2a120a" stroke-width="3" stroke-linecap="round" />
      <path d="M50 61 L60 51" stroke="#b01e2a" stroke-width="4" stroke-linecap="round" />
      <circle cx="50" cy="61" r="3.5" fill="#2a120a" />
      <ellipse cx="30" cy="45" rx="5" ry="3" fill="#ff8a70" transform="rotate(-35 30 45)" />
    </svg>
  );
}
