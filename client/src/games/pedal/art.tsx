import { Pierogi } from '../../lib/art';

/**
 * A pierogi on a bicycle. The wheels turn with the CSS variable `--spin` on any parent
 * (the TV sets it every frame), so redrawing the bike is never needed.
 */
export function Bike({ color, size = 160, mood = 'happy' }: { color: string; size?: number; mood?: 'happy' | 'wow' | 'dead' | 'sleep' }) {
  const wheel = (cx: number) => (
    <g class="bike-wheel">
      <circle cx={cx} cy="82" r="24" fill="none" stroke="#2a120a" stroke-width="7" />
      <circle cx={cx} cy="82" r="24" fill="none" stroke="#6f7787" stroke-width="2.5" />
      <path
        d={`M${cx - 22} 82 H${cx + 22} M${cx} 60 V104 M${cx - 15.5} 66.5 L${cx + 15.5} 97.5 M${cx + 15.5} 66.5 L${cx - 15.5} 97.5`}
        stroke="rgba(255,244,220,.55)"
        stroke-width="2"
      />
      <circle cx={cx} cy="82" r="4" fill="#2a120a" />
    </g>
  );
  return (
    <svg class="bike" width={size} height={(size * 120) / 160} viewBox="0 -10 160 120" aria-hidden="true">
      {wheel(34)}
      {wheel(126)}
      <path
        d="M34 82 L72 82 L104 52 L60 52 Z M72 82 L56 40 M104 52 L126 82 M104 52 L99 36 H113"
        fill="none"
        stroke="#2a120a"
        stroke-width="9"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <path
        d="M34 82 L72 82 L104 52 L60 52 Z M72 82 L56 40 M104 52 L126 82 M104 52 L99 36 H113"
        fill="none"
        stroke={color}
        stroke-width="5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <rect x="46" y="35" width="22" height="7" rx="3.5" fill="#2a120a" />
      <g transform="translate(26 -6)">
        <Pierogi color={color} size={70} mood={mood} />
      </g>
    </svg>
  );
}
