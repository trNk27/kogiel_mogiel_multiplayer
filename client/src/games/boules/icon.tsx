/** Bule: boules on the village green, a golden pierożek as the jack. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M10 84 H90" stroke="#a3e048" stroke-width="5" stroke-linecap="round" />
      <path d="M22 80 Q40 68 66 40" fill="none" stroke="#fff4dc" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 7" opacity=".7" />
      <ellipse cx="68" cy="70" rx="24" ry="4" fill="#000" opacity=".35" />
      <circle cx="30" cy="60" r="19" fill="#9aa4b4" stroke="#2a120a" stroke-width="3" />
      <circle cx="30" cy="60" r="19" fill="none" stroke="#dfe6f2" stroke-width="3" stroke-dasharray="6 120" stroke-dashoffset="-70" stroke-linecap="round" />
      <path d="M17 56 H43 M30 43 V77" stroke="#6c7686" stroke-width="2" opacity=".6" />
      <circle cx="24" cy="52" r="4" fill="#fff" opacity=".6" />
      <circle cx="72" cy="52" r="14" fill="#d8322a" stroke="#2a120a" stroke-width="3" />
      <circle cx="72" cy="52" r="9" fill="none" stroke="#f6efe2" stroke-width="3" />
      <circle cx="67" cy="47" r="3" fill="#fff" opacity=".6" />
      <g transform="translate(60 78)">
        <path d="M-8 0 A8 8 0 0 1 8 0 Z" fill="#ffd23f" stroke="#2a120a" stroke-width="2.5" stroke-linejoin="round" />
      </g>
    </svg>
  );
}
