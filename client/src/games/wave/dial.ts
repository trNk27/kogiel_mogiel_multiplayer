/** Dial geometry shared by the TV dial and the Psychic's little dial picture. Pure. */
import type { Stroke } from '../../../../shared/protocol';
import { BANDS } from './logic';

/** Angle (radians) of a value 0..100 on a half dial: 0 points left, 100 right, 50 straight up. */
export function angleOf(v: number): number {
  return Math.PI * (1 - Math.max(0, Math.min(100, v)) / 100);
}

/** Point at value `v`, radius `r` around (cx, cy), in SVG coordinates (y down). */
export function pointAt(cx: number, cy: number, r: number, v: number): [number, number] {
  const a = angleOf(v);
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
}

/** SVG path of a pie slice from value `a` to `b` (clamped to the dial). */
export function slicePath(cx: number, cy: number, r: number, a: number, b: number): string {
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(100, Math.max(a, b));
  const [x1, y1] = pointAt(cx, cy, r, lo);
  const [x2, y2] = pointAt(cx, cy, r, hi);
  return `M${cx} ${cy}L${x1.toFixed(1)} ${y1.toFixed(1)}A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}Z`;
}

/** The band colours, matching BANDS (4, 3, 2 points). */
export const BAND_COLORS = ['#ff3d6e', '#ffd23f', '#2fd6a8'] as const;
/** Same colours as doodle palette indices, for the phone picture. */
const BAND_INK = [2, 3, 4];

function arc(c: number, w: number, cx: number, cy: number, r: number, a: number, b: number, step = 2): Stroke {
  const s: Stroke = [c, w];
  const lo = Math.max(0, a);
  const hi = Math.min(100, b);
  for (let v = lo; ; v = Math.min(hi, v + step)) {
    const [x, y] = pointAt(cx, cy, r, v);
    s.push(Math.round(x), Math.round(y));
    if (v >= hi) break;
  }
  if (s.length === 4) s.push(s[2], s[3]);
  return s;
}

/**
 * The Psychic's phone picture (doodle strokes on the 1000×1000 paper): a half dial with the
 * scoring wedge and a needle on the target.
 */
export function dialStrokes(target: number): Stroke[] {
  const cx = 500;
  const cy = 790;
  const R = 450;
  const out: Stroke[] = [];
  // Wedge: outer band first, filled with thick concentric arcs.
  for (let b = BANDS.length - 1; b >= 0; b--) {
    for (let r = 70; r <= R - 20; r += 44) out.push(arc(BAND_INK[b], 2, cx, cy, r, target - BANDS[b].d, target + BANDS[b].d, 1));
  }
  // Rim, base line and ticks.
  out.push(arc(0, 1, cx, cy, R, 0, 100, 2));
  out.push([0, 1, cx - R, cy, cx + R, cy]);
  for (let v = 0; v <= 100; v += 10) {
    const [x1, y1] = pointAt(cx, cy, R, v);
    const [x2, y2] = pointAt(cx, cy, R + 40, v);
    out.push([0, v % 50 === 0 ? 1 : 0, Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)]);
  }
  // Needle and hub.
  const [nx, ny] = pointAt(cx, cy, R + 30, target);
  out.push([0, 1, cx, cy, Math.round(nx), Math.round(ny)]);
  out.push([0, 2, cx, cy]);
  return out;
}

/**
 * Markers on the dial that would overlap (guesses closer than `gap`) sit on different rings: the
 * ring index for each guess, 0 being the outermost. Same order as `guesses`.
 */
export function markerTiers(guesses: readonly number[], gap = 7): number[] {
  const order = guesses.map((g, i) => [g, i] as const).sort((a, b) => a[0] - b[0]);
  const tiers = new Array<number>(guesses.length).fill(0);
  const placed: { g: number; t: number }[] = [];
  for (const [g, i] of order) {
    const taken = new Set(placed.filter((p) => Math.abs(p.g - g) < gap).map((p) => p.t));
    let t = 0;
    while (taken.has(t)) t++;
    tiers[i] = t;
    placed.push({ g, t });
  }
  return tiers;
}
