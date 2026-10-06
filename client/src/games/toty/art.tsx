import { DOODLE_COLORS, DOODLE_SPACE, DOODLE_WIDTHS, colorHex, type ColorId, type Stroke } from '../../../../shared/protocol';
import { PIEROGI_PATH, Pierogi } from '../../lib/art';
import { strokePath } from './logic';

/** A player's selfie in a frame of their colour, or their pierogi if they have no photo. */
export function Face({ color, photo, size, mood, class: cls }: { color: ColorId; photo?: string | null; size: number; mood?: 'happy' | 'wow' | 'sleep' | 'dead'; class?: string }) {
  return (
    <div class={`ty-face ${photo ? '' : 'no-photo'} ${cls ?? ''}`} style={{ width: size, height: size, '--pc': colorHex(color) }}>
      {photo ? <img src={photo} alt="" draggable={false} /> : <Pierogi color={colorHex(color)} size={size * 0.72} mood={mood} />}
    </div>
  );
}

/** The blank page Bazgroły drawings are made on. */
export const PAPER = '#fff4dc';

/**
 * A doodle over a photo (or over the player's pierogi, or on a blank page without a `color`),
 * as SVG so it stays sharp on the TV. With `animate`, the strokes are drawn one after another
 * (spread over about `seconds`).
 */
export function Doodle({ strokes, photo, color, animate, seconds = 4, class: cls }: { strokes: Stroke[]; photo?: string | null; color?: ColorId; animate?: boolean; seconds?: number; class?: string }) {
  const step = strokes.length ? Math.min(0.18, seconds / strokes.length) : 0;
  return (
    <svg class={`ty-doodle ${cls ?? ''}`} viewBox={`0 0 ${DOODLE_SPACE} ${DOODLE_SPACE}`} aria-hidden="true">
      <DoodleBackground photo={photo} color={color} />
      {strokes.map((s, i) => {
        const stroke = DOODLE_COLORS[s[0]];
        const width = DOODLE_WIDTHS[s[1]];
        const style = animate ? { animationDelay: `${(i * step).toFixed(2)}s` } : undefined;
        if (s.length === 4) return <circle cx={s[2]} cy={s[3]} r={width / 2} fill={stroke} class={animate ? 'ty-dot' : ''} style={style} />;
        return (
          <path
            d={strokePath(s)}
            fill="none"
            stroke={stroke}
            stroke-width={width}
            stroke-linecap="round"
            stroke-linejoin="round"
            pathLength={1}
            class={animate ? 'ty-stroke' : ''}
            style={style}
          />
        );
      })}
    </svg>
  );
}

function DoodleBackground({ photo, color }: { photo?: string | null; color?: ColorId }) {
  if (photo) return <image href={photo} x="0" y="0" width={DOODLE_SPACE} height={DOODLE_SPACE} preserveAspectRatio="xMidYMid slice" />;
  if (!color) return <rect width={DOODLE_SPACE} height={DOODLE_SPACE} fill={PAPER} />;
  // No selfie: a big pierogi in the player's colour to draw on.
  return (
    <g>
      <rect width={DOODLE_SPACE} height={DOODLE_SPACE} fill="#3d1420" />
      <g transform="translate(140 220) scale(6)">
        <path d={PIEROGI_PATH} fill={colorHex(color)} stroke="rgba(40,16,8,.55)" stroke-width="2" stroke-linejoin="round" />
        <ellipse cx="43" cy="51" rx="5" ry="6" fill="#2a120a" />
        <ellipse cx="77" cy="51" rx="5" ry="6" fill="#2a120a" />
        <path d="M 50 64 q 10 10 20 0" fill="none" stroke="#2a120a" stroke-width="3" stroke-linecap="round" />
      </g>
    </g>
  );
}
