/** Petarda: a detonator plunger wired to a giant red firecracker, with a firework overhead. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#1b1838" />
      <g stroke="#ffd23f" stroke-width="3" stroke-linecap="round">
        <path d="M24 22 l-6 -6 M24 22 l0 -9 M24 22 l7 -6 M24 22 l-9 1 M24 22 l9 2 M24 22 l-6 7 M24 22 l6 7" />
      </g>
      <circle cx="24" cy="22" r="3" fill="#fff4dc" />
      <rect x="56" y="30" width="24" height="52" rx="4" fill="#d8322a" stroke="#2a120a" stroke-width="3" />
      <rect x="55" y="42" width="26" height="6" fill="#ffc93c" stroke="#2a120a" stroke-width="2" />
      <rect x="55" y="64" width="26" height="6" fill="#ffc93c" stroke="#2a120a" stroke-width="2" />
      <rect x="58" y="24" width="20" height="8" rx="2" fill="#f4ecdc" stroke="#2a120a" stroke-width="2.5" />
      <path d="M68 24 q4 -8 -2 -14" fill="none" stroke="#e9d7a8" stroke-width="3" stroke-linecap="round" />
      <circle cx="66" cy="10" r="4" fill="#ffd23f" />
      <path d="M30 80 Q44 92 56 76" fill="none" stroke="#2a120a" stroke-width="3" />
      <rect x="16" y="66" width="22" height="16" rx="3" fill="#b5412e" stroke="#2a120a" stroke-width="3" />
      <path d="M27 66 V48" stroke="#c9ccd3" stroke-width="4" />
      <rect x="17" y="43" width="20" height="7" rx="3.5" fill="#2a2630" stroke="#2a120a" stroke-width="2" />
      <path d="M44 56 l4 -4 M46 62 h6 M44 68 l4 4" stroke="#fff4dc" stroke-width="3" stroke-linecap="round" opacity=".8" />
    </svg>
  );
}
