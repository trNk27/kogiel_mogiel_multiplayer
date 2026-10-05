import { POWER_TARGET, type PowerKind } from './sim';

/** Ring colour says who it hits: green = you, red = everyone else, blue = everyone. */
export const TARGET_COLOR = { self: '#2fd6a8', others: '#ff3d6e', all: '#4f9dff' } as const;

/** Each icon is an SVG path in a 24 × 24 box, stroked; also drawn on the canvas via Path2D. */
export const POWER_INFO: Record<PowerKind, { label: string; toast: string; path: string; width: number }> = {
  speed: { label: 'Faster', toast: 'speeds up', path: 'M5 6 L11 12 L5 18 M12 6 L18 12 L12 18', width: 2.6 },
  brake: { label: 'Slower', toast: 'slows down to steer', path: 'M7 4 H17 L7 20 H17 Z', width: 2.2 },
  rush: { label: 'Others faster', toast: 'speeds everyone else up!', path: 'M5 6 L11 12 L5 18 M12 6 L18 12 L12 18', width: 2.6 },
  slow: { label: 'Others slower', toast: 'slows everyone else down', path: 'M7 4 H17 L7 20 H17 Z', width: 2.2 },
  thin: { label: 'Thin line', toast: 'goes thin', path: 'M4 12 H20', width: 1.6 },
  fat: { label: 'Others fat', toast: 'makes everyone else fat!', path: 'M5 12 H19', width: 7 },
  holes: { label: 'Big gaps', toast: 'goes full of holes', path: 'M3 12 H7 M11 12 H13 M17 12 H21', width: 3 },
  solid: { label: 'Others no gaps', toast: 'takes everyone else’s gaps away!', path: 'M3 12 H21 M3 8 V16 M21 8 V16', width: 2.8 },
  jump: { label: 'Jump', toast: 'jumps over the lines!', path: 'M3 19 Q12 1 21 19 M17 16 L21 19 L22 14', width: 2.4 },
  wrap: { label: 'Through walls', toast: 'can go through walls', path: 'M5 3 V21 M19 3 V21 M9 12 H23 M1 12 H2.5', width: 2.4 },
  clear: { label: 'Clear arena', toast: 'wiped the arena clean!', path: 'M5 19 L15 9 M13 7 L17 11 L21 7 L17 3 Z M3 15 L9 21', width: 2.4 },
};

export function powerColor(kind: PowerKind) {
  return TARGET_COLOR[POWER_TARGET[kind]];
}

const paths = new Map<PowerKind, Path2D>();

/** Draw a power-up icon centred at (x, y), `size` pixels across. */
export function drawPowerIcon(ctx: CanvasRenderingContext2D, kind: PowerKind, x: number, y: number, size: number, color: string) {
  let p = paths.get(kind);
  if (!p) paths.set(kind, (p = new Path2D(POWER_INFO[kind].path)));
  const k = size / 24;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(k, k);
  ctx.strokeStyle = color;
  ctx.lineWidth = POWER_INFO[kind].width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(p);
  ctx.restore();
}

export function PowerIcon({ kind, size = 30 }: { kind: PowerKind; size?: number }) {
  return (
    <span class="trails-legend-dot" style={{ width: size, height: size, background: powerColor(kind) }}>
      <svg width={size * 0.72} height={size * 0.72} viewBox="0 0 24 24" aria-hidden="true">
        <path d={POWER_INFO[kind].path} fill="none" stroke="#2a120a" stroke-width={POWER_INFO[kind].width} stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
  );
}
