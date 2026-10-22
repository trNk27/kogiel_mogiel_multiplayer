/** Owieczki: a fluffy sheep at the gate of a wooden pen, with a mountain behind. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M10 66 L34 34 L46 50 L62 28 L90 66 Z" fill="#8ea6bd" />
      <path d="M62 28 L54 41 L60 38 L64 43 L70 38 Z" fill="#fff" opacity=".9" />
      <path d="M8 66 H92 V86 Q50 94 8 86 Z" fill="#6fb04a" />
      <path d="M62 62 V82 M70 62 V82 M78 62 V82 M86 62 V82 M60 68 H88 M60 76 H88" stroke="#a0693a" stroke-width="3" stroke-linecap="round" />
      <ellipse cx="36" cy="84" rx="20" ry="3.5" fill="#000" opacity=".3" />
      <g stroke="#2a120a" stroke-width="2.8" stroke-linejoin="round">
        <path d="M24 82 v-8 M44 82 v-8" stroke-linecap="round" stroke-width="4" />
        <g fill="#fffaf0">
          <circle cx="26" cy="64" r="9" />
          <circle cx="36" cy="58" r="10" />
          <circle cx="47" cy="64" r="9" />
          <circle cx="36" cy="70" r="10" />
        </g>
        <path d="M54 62 q8 -2 8 6 q0 6 -7 5 q-4 -4 -1 -11 z" fill="#4a3c38" />
      </g>
      <circle cx="58" cy="66" r="1.5" fill="#fff" />
    </svg>
  );
}
