/** Wesele: a shot glass of vodka clinking with another, over a wedding-pink heart. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#5d2a3c" />
      <path d="M50 82 C20 62 14 44 24 32 C34 20 46 26 50 36 C54 26 66 20 76 32 C86 44 80 62 50 82 Z" fill="#ff8fb1" stroke="#2a120a" stroke-width="3" />
      <g transform="rotate(-18 34 50)">
        <path d="M22 30 L44 30 L41 62 L25 62 Z" fill="#e8f6ff" fill-opacity=".9" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <path d="M24 40 L42 40 L41 60 L25 60 Z" fill="#bfe3ff" />
      </g>
      <g transform="rotate(18 66 50)">
        <path d="M56 30 L78 30 L75 62 L59 62 Z" fill="#e8f6ff" fill-opacity=".9" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <path d="M58 40 L76 40 L75 60 L59 60 Z" fill="#bfe3ff" />
      </g>
      <path d="M50 14 v10 M40 18 l4 7 M60 18 l-4 7" stroke="#ffd23f" stroke-width="4" stroke-linecap="round" />
    </svg>
  );
}
