/** Pół na Pół: a pierogi cut in half, green on one side and red on the other. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M14 66 A36 36 0 0 1 48 30 L48 66 Z" fill="#2fb07a" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <path d="M86 66 A36 36 0 0 0 52 30 L52 66 Z" fill="#e8335a" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <path d="M50 18 L50 84" stroke="#ffd23f" stroke-width="4" stroke-dasharray="6 5" stroke-linecap="round" />
      <text x="31" y="60" text-anchor="middle" font-family="Georgia, serif" font-weight="900" font-size="15" fill="#fff">YES</text>
      <text x="69" y="60" text-anchor="middle" font-family="Georgia, serif" font-weight="900" font-size="15" fill="#fff">NO</text>
      <text x="50" y="84" text-anchor="middle" font-family="Georgia, serif" font-weight="900" font-size="13" fill="#fbf0d9">50 / 50</text>
    </svg>
  );
}
