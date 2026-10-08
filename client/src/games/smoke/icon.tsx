/** Fajki: the spinning tray of coloured cigarettes, one lit, with a curl of smoke. */
const COLORS = ['#ff3d6e', '#ffd23f', '#4f9dff', '#a3e048', '#b27bff', '#ff8a2a'];

export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      <circle cx="50" cy="56" r="33" fill="#a46a3a" stroke="#2a120a" stroke-width="3" />
      {COLORS.map((c, i) => (
        <g transform={`translate(50 56) rotate(${i * 60 + 15})`}>
          <rect x="9" y="-3.5" width="17" height="7" fill={c} stroke="#2a120a" stroke-width="1.8" />
          <rect x="26" y="-3.5" width="6" height="7" rx="1.5" fill="#e0a256" stroke="#2a120a" stroke-width="1.8" />
        </g>
      ))}
      <circle cx="50" cy="56" r="8" fill="#7a4a26" stroke="#2a120a" stroke-width="2.5" />
      <path d="M50 22 q -9 -6 0 -10 q 9 -4 2 -9" fill="none" stroke="#d9d4ca" stroke-width="4" stroke-linecap="round" />
      <path d="M86 18 a 6 6 0 0 1 -12 0" fill="none" stroke="#d9d4ca" stroke-width="3" stroke-linecap="round" opacity=".7" />
    </svg>
  );
}
