/** Głuchy Telefon: two tin-can telephones on a wobbly string, and a scribbled note going wrong. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      {/* the note: a sentence, then a doodle */}
      <g transform="rotate(-7 50 30)">
        <rect x="27" y="12" width="46" height="34" rx="5" fill="#fff4dc" stroke="#2a120a" stroke-width="2.5" />
        <path d="M33 21 h20 M33 27 h14" stroke="#9e8a70" stroke-width="3" stroke-linecap="round" />
        <circle cx="61" cy="31" r="7" fill="none" stroke="#ff3d6e" stroke-width="3" />
        <path d="M33 38 q6 -6 12 0 t12 0" fill="none" stroke="#4f9dff" stroke-width="3" stroke-linecap="round" />
      </g>
      {/* the string */}
      <path d="M25 70 C 38 86, 44 58, 52 72 S 66 84, 75 70" fill="none" stroke="#fff4dc" stroke-width="2.5" stroke-linecap="round" />
      {/* left can */}
      <g transform="rotate(18 20 68)">
        <rect x="9" y="58" width="20" height="22" rx="3" fill="#ffc93c" stroke="#2a120a" stroke-width="2.5" />
        <path d="M9 64 h20 M9 74 h20" stroke="#c98a00" stroke-width="2" />
        <ellipse cx="29" cy="69" rx="3" ry="11" fill="#c98a00" stroke="#2a120a" stroke-width="2.5" />
      </g>
      {/* right can */}
      <g transform="rotate(-18 80 68)">
        <rect x="71" y="58" width="20" height="22" rx="3" fill="#e8335a" stroke="#2a120a" stroke-width="2.5" />
        <path d="M71 64 h20 M71 74 h20" stroke="#9e1a3a" stroke-width="2" />
        <ellipse cx="71" cy="69" rx="3" ry="11" fill="#9e1a3a" stroke="#2a120a" stroke-width="2.5" />
      </g>
      {/* a little "?" of confusion */}
      <text x="80" y="50" font-family="Georgia, serif" font-weight="900" font-size="18" fill="#2fd6a8">?</text>
    </svg>
  );
}
