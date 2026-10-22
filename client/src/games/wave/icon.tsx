/** Fala: a half dial with the scoring wedge and a pierogi-yellow needle. */
export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <path d="M10 72 A40 40 0 0 1 90 72 Z" fill="#2a120a" />
      <path d="M15 70 A35 35 0 0 1 85 70 Z" fill="#fff4dc" />
      <path d="M50 70 L71.4 42.3 A35 35 0 0 1 81.8 55.4 Z" fill="#2fd6a8" stroke="#2a120a" stroke-width="1.5" />
      <path d="M50 70 L75.3 45.8 A35 35 0 0 1 79.9 52.4 Z" fill="#ffd23f" stroke="#2a120a" stroke-width="1.5" />
      <path d="M50 70 L77 47.6 A35 35 0 0 1 78.6 50.1 Z" fill="#ff3d6e" />
      <path d="M50 70 L70 49" stroke="#2a120a" stroke-width="5" stroke-linecap="round" />
      <path d="M50 70 L70 49" stroke="#ffd23f" stroke-width="2" stroke-linecap="round" />
      <rect x="8" y="70" width="84" height="10" rx="4" fill="#2a120a" />
      <circle cx="50" cy="70" r="6" fill="#ffc93c" stroke="#2a120a" stroke-width="2.5" />
      <path d="M14 88 q9 -6 18 0 t18 0 t18 0 t18 0" fill="none" stroke="#4f9dff" stroke-width="3.5" stroke-linecap="round" />
    </svg>
  );
}
