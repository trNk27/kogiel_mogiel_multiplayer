/**
 * Pure pixel-art utilities: color ramp generation, declarative grid validation/compilation,
 * crisp 5×7 pixel bitmap typography, and Bayer dithering.
 *
 * Node/Vitest-safe: DOM canvas helpers check `typeof document !== 'undefined'`.
 */

export interface PixelRamp {
  /** Dark hue-shifted outline color. */
  out: string;
  /** Deepest shadow tone. */
  deep: string;
  /** Mid shadow tone. */
  shade: string;
  /** Main body color. */
  base: string;
  /** Crisp highlight tone. */
  hi: string;
}

type Rgb = readonly [number, number, number];

function parseHex(hex: string): Rgb {
  const clean = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return [r, g, b];
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
  }
  return [255, 244, 220];
}

function toHex(rgb: Rgb): string {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${ch(rgb[0])}${ch(rgb[1])}${ch(rgb[2])}`;
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function lum(rgb: Rgb): number {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

/**
 * Generates a 5-step hue-shifted pixel-art color ramp from any base color hex.
 * Shadows shift subtly cooler toward deep plum/indigo (`#120d1b`) so even light cream (`#fff4dc`)
 * retains crisp dark pixel outlines and readable shading.
 */
export function playerPixelRamp(hex: string): PixelRamp {
  const raw = parseHex(hex);
  // Prevent pure white from leaving no room for a brighter highlight pixel.
  const baseRgb: Rgb = lum(raw) > 250 ? [242, 238, 228] : lum(raw) < 35 ? [55, 55, 65] : raw;
  const hiRgb = mixRgb(baseRgb, [255, 255, 255], 0.52);
  const shadeRgb = mixRgb(baseRgb, [36, 20, 48], 0.28);
  const deepRgb = mixRgb(baseRgb, [22, 12, 34], 0.54);
  const outRgb = mixRgb(baseRgb, [14, 9, 24], 0.84);
  return {
    out: toHex(outRgb),
    deep: toHex(deepRgb),
    shade: toHex(shadeRgb),
    base: toHex(baseRgb),
    hi: toHex(hiRgb),
  };
}

/** Expands `$out`, `$deep`, `$shade`, `$base`, `$hi` tokens inside a sprite palette. */
export function expandPixelPalette(palette: Record<string, string>, colorHex = '#fff4dc'): Record<string, string> {
  const ramp = playerPixelRamp(colorHex);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(palette)) {
    switch (v) {
      case '$out':
        out[k] = ramp.out;
        break;
      case '$deep':
        out[k] = ramp.deep;
        break;
      case '$shade':
        out[k] = ramp.shade;
        break;
      case '$base':
        out[k] = ramp.base;
        break;
      case '$hi':
        out[k] = ramp.hi;
        break;
      default:
        out[k] = v;
        break;
    }
  }
  return out;
}

/** Validates that a pixel grid has non-empty uniform rows and every non-transparent symbol is defined. */
export function validatePixelGrid(pixels: readonly string[], palette: Record<string, string>): { width: number; height: number; errors: string[] } {
  const errors: string[] = [];
  if (!pixels.length) {
    return { width: 0, height: 0, errors: ['Pixel grid has 0 rows'] };
  }
  const width = pixels[0].length;
  if (width === 0) errors.push('Pixel grid row 0 is empty');
  for (let y = 0; y < pixels.length; y++) {
    const row = pixels[y];
    if (row.length !== width) errors.push(`Row ${y} width ${row.length} !== expected ${width}`);
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      if (!(ch in palette)) errors.push(`Undefined palette symbol "${ch}" at (${x},${y})`);
    }
  }
  return { width, height: pixels.length, errors };
}

/** Compiles a pixel grid into a crisp 1× offscreen canvas (`null` in non-DOM environments). */
export function compilePixelGrid(pixels: readonly string[], palette: Record<string, string>, flipX = false): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const h = pixels.length;
  const w = h > 0 ? pixels[0].length : 0;
  if (w === 0 || h === 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < h; y++) {
    const row = pixels[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const col = palette[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(flipX ? w - 1 - x : x, y, 1, 1);
    }
  }
  return canvas;
}

/** Crisp 5×7 pixel bitmap font for in-canvas labels, combos, and HUD badges. */
export const PIXEL_FONT_5X7: Record<string, readonly string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#..##', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#..##', '#.#.#', '#.#.#', '#.#.#', '##..#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '..##.', '.#...', '#....', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['#...#', '#...#', '#...#', '#####', '....#', '....#', '....#'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '####.', '#...#', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '..##.', '..#..', '.....', '..#..'],
  ':': ['.....', '..#..', '..#..', '.....', '..#..', '..#..', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.....', '..#..'],
  ',': ['.....', '.....', '.....', '.....', '.....', '..#..', '.#...'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  '×': ['.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....'],
  '#': ['.#.#.', '#####', '.#.#.', '.#.#.', '#####', '.#.#.', '.....'],
  '%': ['##..#', '##.#.', '..#..', '..#..', '.#.##', '#..##', '.....'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
};

const DIACRITICS: Record<string, string> = {
  Ą: 'A',
  Ć: 'C',
  Ę: 'E',
  Ł: 'L',
  Ń: 'N',
  Ó: 'O',
  Ś: 'S',
  Ź: 'Z',
  Ż: 'Z',
};

function normalizeChar(ch: string): string {
  const up = ch.toUpperCase();
  return DIACRITICS[up] ?? (up in PIXEL_FONT_5X7 ? up : ' ');
}

/** Width and height in canvas pixels of `text` rendered in the 5×7 bitmap font. */
export function measurePixelText(text: string, scale = 1): { width: number; height: number } {
  if (!text.length) return { width: 0, height: 7 * scale };
  return {
    width: (text.length * 6 - 1) * scale,
    height: 7 * scale,
  };
}

export interface PixelTextOpts {
  scale?: number;
  color?: string;
  outline?: string;
  align?: 'left' | 'center' | 'right';
  baseline?: 'top' | 'middle' | 'bottom';
}

/** Draws crisp integer-snapped 5×7 pixel bitmap text onto a 2D canvas. */
export function drawPixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, opts: PixelTextOpts = {}): void {
  const scale = Math.max(1, Math.round(opts.scale ?? 1));
  const color = opts.color ?? '#ffffff';
  const align = opts.align ?? 'left';
  const baseline = opts.baseline ?? 'top';
  const { width, height } = measurePixelText(text, scale);
  const ox = Math.round(x - (align === 'center' ? width / 2 : align === 'right' ? width : 0));
  const oy = Math.round(y - (baseline === 'middle' ? height / 2 : baseline === 'bottom' ? height : 0));

  const glyphs = Array.from(text, (ch) => PIXEL_FONT_5X7[normalizeChar(ch)]);
  const stamp = (dx: number, dy: number, fill: string) => {
    ctx.fillStyle = fill;
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      const gx = ox + i * 6 * scale + dx;
      for (let py = 0; py < 7; py++) {
        const row = g[py];
        for (let px = 0; px < 5; px++) {
          if (row[px] === '#') ctx.fillRect(gx + px * scale, oy + py * scale + dy, scale, scale);
        }
      }
    }
  };

  if (opts.outline) {
    stamp(-scale, 0, opts.outline);
    stamp(scale, 0, opts.outline);
    stamp(0, -scale, opts.outline);
    stamp(0, scale, opts.outline);
  }
  stamp(0, 0, color);
}

/** Paints a 2×2 Bayer dithered band mixing `colorA` and `colorB` for 16-bit sky gradients. */
export function ditherBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  colorA: string,
  colorB: string,
  density: 0.25 | 0.5 | 0.75 = 0.5,
): void {
  const ix = Math.round(x);
  const iy = Math.round(y);
  const iw = Math.round(w);
  const ih = Math.round(h);
  ctx.fillStyle = colorA;
  ctx.fillRect(ix, iy, iw, ih);
  ctx.fillStyle = colorB;
  for (let py = 0; py < ih; py++) {
    for (let px = 0; px < iw; px++) {
      const m = (px & 1) + ((py & 1) << 1);
      // Threshold table on a 2×2 Bayer pattern: [0, 2; 3, 1].
      const on = density === 0.25 ? m === 0 : density === 0.5 ? m === 0 || m === 3 : m !== 2;
      if (on) ctx.fillRect(ix + px, iy + py, 1, 1);
    }
  }
}
