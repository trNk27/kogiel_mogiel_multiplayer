import { PIEROGI_PATH } from '../../lib/art';

/** Lodowa Wieża: icy brick tower walls, snowy pixel-stepped ledges, golden crown, and a wall-bouncing pierogi. */
export function Icon({ size = 80 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#182046" />
      {/* Twinkling snow stars */}
      <rect x="14" y="16" width="3" height="3" fill="#fff4dc" />
      <rect x="84" y="20" width="3" height="3" fill="#79d2ff" />
      <rect x="13" y="64" width="2.5" height="2.5" fill="#9ee6ff" />
      <rect x="85" y="72" width="2.5" height="2.5" fill="#fff4dc" />
      {/* Tower interior shaft */}
      <rect x="24" y="12" width="52" height="78" fill="#202750" />
      {/* Brick walls on left and right */}
      <rect x="18" y="12" width="10" height="78" fill="#495484" stroke="#120d1b" stroke-width="2.5" />
      <rect x="72" y="12" width="10" height="78" fill="#495484" stroke="#120d1b" stroke-width="2.5" />
      <rect x="26" y="12" width="3" height="78" fill="#9ee6ff" />
      <rect x="71" y="12" width="3" height="78" fill="#9ee6ff" />
      {/* Snowy pixel-stepped platforms */}
      <rect x="28" y="76" width="44" height="8" fill="#495484" stroke="#120d1b" stroke-width="2" />
      <rect x="28" y="76" width="44" height="3" fill="#e8f8ff" />
      <rect x="30" y="54" width="26" height="7" fill="#3282bf" stroke="#120d1b" stroke-width="2" />
      <rect x="30" y="54" width="26" height="2.5" fill="#ffffff" />
      <rect x="46" y="34" width="24" height="7" fill="#3282bf" stroke="#120d1b" stroke-width="2" />
      <rect x="46" y="34" width="24" height="2.5" fill="#ffffff" />
      {/* Golden crown at summit */}
      <path d="M40 24 L43 15 L47 20 L50 13 L53 20 L57 15 L60 24 Z" fill="#ffd23f" stroke="#120d1b" stroke-width="2" stroke-linejoin="round" />
      {/* Jumping yolk pierogi with wall-bounce sparks */}
      <path d="M31 44 L36 47 M31 50 L36 49" stroke="#79d2ff" stroke-width="2.5" stroke-linecap="round" />
      <g transform="translate(36 33) rotate(-14) scale(.26)">
        <path d={PIEROGI_PATH} fill="#ffd23f" stroke="#120d1b" stroke-width="8" />
        <circle cx="44" cy="52" r="7" fill="#120d1b" />
        <circle cx="76" cy="52" r="7" fill="#120d1b" />
      </g>
    </svg>
  );
}
