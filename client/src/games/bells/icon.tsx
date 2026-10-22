/** Dzwonki: four little bells in a row under a shingled belfry roof, one of them ringing. */
export function Icon({ size }: { size: number }) {
  const bell = (x: number, y: number, s: number, c: string, tilt = 0) => (
    <g transform={`translate(${x} ${y}) rotate(${tilt}) scale(${s})`}>
      <path d="M-9 10 C-9 2 -7 -8 0 -9 C7 -8 9 2 9 10 Z" fill={c} stroke="#2a120a" stroke-width="2.6" stroke-linejoin="round" />
      <path d="M-11 10 H11" stroke="#2a120a" stroke-width="3" stroke-linecap="round" />
      <circle cx="0" cy="13" r="2.6" fill="#2a120a" />
    </g>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#2a2a63" />
      <circle cx="78" cy="24" r="5" fill="#fff1c8" />
      <path d="M8 40 L50 12 L92 40 Z" fill="#7a4a2c" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
      <path d="M22 31 H78 M34 23 H66" stroke="#4a2814" stroke-width="2" />
      <path d="M12 42 H88" stroke="#5e3519" stroke-width="5" stroke-linecap="round" />
      <path d="M14 42 V90 M86 42 V90" stroke="#5e3519" stroke-width="5" stroke-linecap="round" />
      {bell(26, 54, 1.0, '#ff3d6e')}
      {bell(44, 53, 0.85, '#ffd23f', 18)}
      {bell(60, 52, 0.75, '#2fd6a8')}
      {bell(74, 51, 0.66, '#4f9dff')}
      <path d="M53 46 q5 -3 8 1 M55 40 q7 -4 11 1" fill="none" stroke="#fff4dc" stroke-width="2.4" stroke-linecap="round" opacity=".8" />
      <path d="M30 80 l4 -8 4 8 M62 82 l3 -6 3 6" fill="none" stroke="#fff4dc" stroke-width="2.4" stroke-linecap="round" opacity=".55" />
    </svg>
  );
}
