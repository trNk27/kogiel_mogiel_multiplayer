import { PIEROGI_PATH } from '../../lib/art';

/**
 * A cigarette lying along +x from (0, 0): ember and ash at x = 0, then the paper in the player's
 * colour, then the filter. `frac` (0–1) is how much is left; the filter never burns.
 */
export function Cig({ color, len = 110, w = 16, frac = 1, lit = false, glow = false }: { color: string; len?: number; w?: number; frac?: number; lit?: boolean; glow?: boolean }) {
  const filter = len * 0.26;
  const paper = (len - filter) * Math.max(0, Math.min(1, frac));
  const x0 = len - filter - paper;
  return (
    <g class="cig">
      <rect x={x0} y={-w / 2} width={len - x0} height={w} rx={w * 0.3} fill="#2a120a" transform={`translate(0 ${w * 0.15})`} opacity=".35" />
      <rect x={x0} y={-w / 2} width={paper + 1} height={w} fill={color} stroke="#2a120a" stroke-width="2.5" />
      <rect x={len - filter} y={-w / 2} width={filter} height={w} rx={w * 0.25} fill="#e0a256" stroke="#2a120a" stroke-width="2.5" />
      <path d={`M${len - filter * 0.7} ${-w / 2} v${w} M${len - filter * 0.4} ${-w / 2} v${w}`} stroke="#b97832" stroke-width="2" />
      {lit && (
        <g>
          <rect x={x0 - 6} y={-w / 2 + 1} width={8} height={w - 2} rx="2" fill="#8f8a84" />
          <circle class={`cig-ember ${glow ? 'hot' : ''}`} cx={x0 - 6} cy="0" r={w * 0.42} />
        </g>
      )}
    </g>
  );
}

/** A pierogi saying cheese: a closed smile that opens into a big grin with `teeth` coloured teeth. */
export function GrinPierogi({ color, teeth, size }: { color: string; teeth: string; size: number }) {
  return (
    <svg width={size} height={size * 0.8} viewBox="0 0 120 96" aria-hidden="true" style={{ '--teeth': teeth }}>
      <path d={PIEROGI_PATH} fill={color} stroke="rgba(40,16,8,.55)" stroke-width="3" stroke-linejoin="round" />
      <path d="M 18 64 A 42 42 0 0 1 102 64" fill="none" stroke="rgba(40,16,8,.22)" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round" />
      <path d="M 12 70 Q 60 92 108 70 Q 60 84 12 70 Z" fill="rgba(40,16,8,.14)" />
      <g class="tw-eyes-open">
        <ellipse cx="41" cy="44" rx="5.5" ry="6.5" fill="#2a120a" />
        <ellipse cx="79" cy="44" rx="5.5" ry="6.5" fill="#2a120a" />
        <circle cx="43" cy="41.5" r="2" fill="#fff" />
        <circle cx="81" cy="41.5" r="2" fill="#fff" />
      </g>
      <path class="tw-eyes-squint" d="M 34 46 q 7 -9 14 0 M 72 46 q 7 -9 14 0" fill="none" stroke="#2a120a" stroke-width="3.5" stroke-linecap="round" />
      <path class="tw-smile" d="M 50 60 q 10 9 20 0" fill="none" stroke="#2a120a" stroke-width="3.5" stroke-linecap="round" />
      <g class="tw-grin">
        <path d="M 32 54 H 88 Q 86 80 60 81 Q 34 80 32 54 Z" fill="#5a1020" stroke="#2a120a" stroke-width="3" stroke-linejoin="round" />
        <path class="tw-teeth" d="M 35 55.5 H 85 Q 84.5 63 83 65 H 37 Q 35.5 63 35 55.5 Z" stroke="#2a120a" stroke-width="1.6" />
        <path d="M 43.3 55.5 V 65 M 51.6 55.5 V 65 M 60 55.5 V 65 M 68.4 55.5 V 65 M 76.7 55.5 V 65" stroke="#2a120a" stroke-width="1.6" opacity=".6" />
        <path d="M 46 75 Q 60 70 74 75 Q 60 80 46 75 Z" fill="#e8607a" />
      </g>
      <ellipse cx="28" cy="58" rx="6" ry="3.5" fill="#ff5a7a" opacity=".45" />
      <ellipse cx="92" cy="58" rx="6" ry="3.5" fill="#ff5a7a" opacity=".45" />
    </svg>
  );
}
