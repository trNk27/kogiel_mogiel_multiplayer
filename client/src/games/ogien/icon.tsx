import { PIEROGI_PATH } from "../../lib/art";

/** Ogień i Lód: a flame-crowned pierogi on a lava pool and a frost-crowned one on icy water, between them a door held open. */
export function Icon({ size = 80 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="og-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#4a1f16" />
          <stop offset="1" stop-color="#14304a" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="92" height="92" rx="22" fill="url(#og-bg)" />
      {/* Floor with a lava pool and a water pool */}
      <rect x="10" y="74" width="80" height="14" rx="3" fill="#6e5b50" />
      <path d="M14 76 q5 -3 10 0 t10 0 t10 0 v8 h-30 z" fill="#ff5a1f" />
      <path d="M56 76 q5 -3 10 0 t10 0 t10 0 v8 h-30 z" fill="#2f8fe0" />
      {/* Door held open in the middle */}
      <rect x="46" y="40" width="8" height="34" fill="#ffd23f" opacity=".35" />
      <rect x="46" y="38" width="8" height="6" fill="#ffd23f" />
      {/* Fire pierogi */}
      <g transform="translate(14 46) scale(.26)">
        <path
          d="M30 22 q4 -24 14 -30 q-2 16 8 24 q6 -18 16 -22 q-4 16 4 28"
          fill="#ff8a3d"
        />
        <path
          d={PIEROGI_PATH}
          fill="#ffb347"
          stroke="#7a2208"
          stroke-width="7"
        />
        <ellipse cx="48" cy="52" rx="6" ry="8" fill="#2a120a" />
        <ellipse cx="78" cy="52" rx="6" ry="8" fill="#2a120a" />
      </g>
      {/* Ice pierogi */}
      <g transform="translate(57 46) scale(.26)">
        <path
          d="M34 22 l8 -26 l8 26 M56 22 l8 -32 l8 32 M78 22 l6 -22 l6 22"
          fill="#e6f8ff"
          stroke="#4bb3e6"
          stroke-width="4"
        />
        <path
          d={PIEROGI_PATH}
          fill="#bfe9ff"
          stroke="#0d4a78"
          stroke-width="7"
        />
        <ellipse cx="42" cy="52" rx="6" ry="8" fill="#2a120a" />
        <ellipse cx="72" cy="52" rx="6" ry="8" fill="#2a120a" />
      </g>
    </svg>
  );
}
