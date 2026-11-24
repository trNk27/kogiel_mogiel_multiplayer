/** Upij Kubę: a straight-faced pierogi with a full shot glass, and a speech bubble going "haha". */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1a12" />
      <path
        d="M12 20 H52 Q58 20 58 26 V40 Q58 46 52 46 H30 L20 55 L22 46 H18 Q12 46 12 40 V26 Q12 20 18 20 Z"
        fill="#fbf0d9"
        stroke="#2a120a"
        stroke-width="3"
        stroke-linejoin="round"
      />
      <text
        x="35"
        y="38"
        text-anchor="middle"
        font-size="14"
        font-weight="900"
        fill="#ff3d6e"
        font-family="system-ui, sans-serif"
      >
        haha
      </text>
      <path
        d="M18 84 A26 26 0 0 1 70 84 Q44 94 18 84 Z"
        fill="#ffd23f"
        stroke="#2a120a"
        stroke-width="3"
        stroke-linejoin="round"
      />
      <circle cx="35" cy="72" r="3.5" fill="#2a120a" />
      <circle cx="52" cy="72" r="3.5" fill="#2a120a" />
      <path
        d="M37 80 H50"
        stroke="#2a120a"
        stroke-width="3"
        stroke-linecap="round"
      />
      <path
        d="M70 52 H90 L87 84 H73 Z"
        fill="rgba(255,255,255,.2)"
        stroke="#fbf0d9"
        stroke-width="3"
        stroke-linejoin="round"
      />
      <path d="M72 62 H88 L86 82 H74 Z" fill="#f3e9c6" />
      <circle cx="84" cy="56" r="2" fill="#fff" />
    </svg>
  );
}
