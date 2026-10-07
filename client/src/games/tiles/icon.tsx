/** Kafelki: a floor of painted tiles with a rolling pin. */
const COLORS = ['#ff3d6e', '#ff3d6e', '#4f9dff', '#ffd23f', '#ff3d6e', '#4f9dff', '#fff4dc', '#ffd23f', '#4f9dff'];

export function Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="22" fill="#3a1420" />
      {COLORS.map((c, i) => (
        <rect x={15 + (i % 3) * 25} y={15 + Math.floor(i / 3) * 25} width="22" height="22" rx="5" fill={c} stroke="#2a120a" stroke-width="3" />
      ))}
      <path d="M63 40 l4 6 l-4 5 l5 6" fill="none" stroke="#2a120a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      <g transform="rotate(-35 50 50)">
        <rect x="14" y="44" width="72" height="14" rx="7" fill="#e0a868" stroke="#2a120a" stroke-width="3" />
        <rect x="4" y="47" width="14" height="8" rx="4" fill="#a8693a" stroke="#2a120a" stroke-width="3" />
        <rect x="82" y="47" width="14" height="8" rx="4" fill="#a8693a" stroke="#2a120a" stroke-width="3" />
      </g>
    </svg>
  );
}
