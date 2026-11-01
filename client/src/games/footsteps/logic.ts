/**
 * Śladami Babci ("in Babcia's footsteps"): the pure rules. A snowy clearing in front of Babcia's
 * cottage. Babcia walks a shape across the fresh snow and drops a rowan berry every step, so her trail
 * shows up as a red line behind her. Then it's your turn: walk the same trail, and your own footprints
 * show as a line in your colour. Babcia's berries stay for a moment, then the snow covers them and you
 * finish from memory. The closer your trail is to hers, the more points. No DOM and no three.js in here.
 */
import type { Rng } from '../rng';

export const DT = 1 / 60;

export const ROUNDS = 3;
export const ROUNDS_SHORT = 1;

/** The clearing: a circle of snow this wide (radius, m). */
export const ARENA_R = 13;
/** Shapes stay inside this radius, so there's room to walk round them. */
export const SHAPE_R = 9.5;

export const WALK = 6;
export const ACCEL = 40;
export const PLAYER_R = 0.6;
export const DEADZONE = 0.14;

/** A footprint is recorded every this many metres (and Babcia drops a berry as often). */
export const DOT_GAP = 0.3;
/** The most footprints one trail holds (about 180 m: far more than any shape). */
export const MAX_DOTS = 600;
/** Resampling step for the accuracy measure. */
export const SAMPLE = 0.25;
/**
 * Accuracy from how far apart the two trails are (see `accuracy`): 100 % for a perfect copy, 50 % at
 * TOL metres, and falling off from there.
 */
export const TOL = 2;

/** Babcia stands still for this long before she sets off, and after she's done. */
export const START_PAUSE = 1.2;
export const END_PAUSE = 0.8;
/** Babcia's walking speed by difficulty. */
export const BABCIA_SPEED = [5, 5.6, 6.2];
/** How long the trail stays after you're let go, by difficulty, and then how long the snow takes to cover it. */
export const HOLD_S = [3.5, 2.6, 1.8];
export const FADE_S = 1.5;
/** Time to walk it yourself: the trail's length at your walking speed, times this, plus TRACE_EXTRA. */
export const TRACE_SLACK = 1.35;
export const TRACE_EXTRA = 5;
/** Where Babcia goes to watch once she's done: the top-left edge of the clearing, out of everyone's way. */
export const WATCH_X = -8.6;
export const WATCH_Z = -9.2;
/** Path length a shape is scaled to, by difficulty (unless it would get too big). */
export const TARGET_LEN = [38, 46, 54];

export type Difficulty = 0 | 1 | 2;

interface Template {
  name: string;
  /** Unit-sized points, y up. */
  pts: [number, number][];
  closed: boolean;
}

const ring = (n: number, r: (k: number, a: number) => number, phase = Math.PI / 2): [number, number][] =>
  Array.from({ length: n }, (_, k) => {
    const a = phase + (k / n) * Math.PI * 2;
    const rr = r(k, a);
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  });

/** The shapes Babcia walks, from easy to hard. */
export const SHAPES: Template[][] = [
  [
    { name: 'Triangle', pts: ring(3, () => 1, Math.PI / 2), closed: true },
    { name: 'Square', pts: ring(4, () => 1, Math.PI / 4), closed: true },
    { name: 'Circle', pts: ring(28, () => 0.9), closed: true },
    {
      name: 'Zigzag',
      pts: [
        [-1, -0.45],
        [-0.5, 0.45],
        [0, -0.45],
        [0.5, 0.45],
        [1, -0.45],
      ],
      closed: false,
    },
  ],
  [
    {
      name: 'House',
      pts: [
        [-0.7, -0.85],
        [0.7, -0.85],
        [0.7, 0.2],
        [0, 0.95],
        [-0.7, 0.2],
      ],
      closed: true,
    },
    {
      name: 'Heart',
      pts: Array.from({ length: 36 }, (_, k) => {
        const t = (k / 36) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3;
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        return [x / 17, (y + 3) / 17] as [number, number];
      }),
      closed: true,
    },
    {
      name: 'Snake',
      pts: [
        ...Array.from({ length: 13 }, (_, k): [number, number] => {
          const a = Math.PI - (k / 12) * Math.PI;
          return [-0.5 + Math.cos(a) * 0.5, Math.sin(a) * 0.5];
        }),
        ...Array.from({ length: 12 }, (_, k): [number, number] => {
          const a = Math.PI + ((k + 1) / 12) * Math.PI;
          return [0.5 + Math.cos(a) * 0.5, Math.sin(a) * 0.5];
        }),
      ],
      closed: false,
    },
    {
      name: 'Lightning',
      pts: [
        [-0.3, 1],
        [0.35, 0.1],
        [-0.25, 0.05],
        [0.4, -1],
      ],
      closed: false,
    },
    { name: 'Diamond', pts: ring(4, (k) => (k % 2 ? 0.6 : 1), Math.PI / 2), closed: true },
  ],
  [
    { name: 'Star', pts: ring(10, (k) => (k % 2 ? 0.42 : 1)), closed: true },
    {
      name: 'Spiral',
      pts: Array.from({ length: 50 }, (_, k): [number, number] => {
        const u = k / 49;
        const a = u * Math.PI * 2 * 1.75;
        const r = 0.18 + u * 0.82;
        return [Math.cos(a) * r, Math.sin(a) * r];
      }),
      closed: false,
    },
    {
      name: 'Figure eight',
      pts: Array.from({ length: 40 }, (_, k): [number, number] => {
        const t = (k / 40) * Math.PI * 2;
        return [Math.sin(t) * 1, Math.sin(t) * Math.cos(t) * 1.1];
      }),
      closed: true,
    },
    {
      name: 'Pierogi',
      pts: [
        ...Array.from({ length: 15 }, (_, k): [number, number] => {
          const a = (k / 14) * Math.PI;
          const r = k % 2 ? 0.84 : 1;
          return [Math.cos(a) * r, -0.45 + Math.sin(a) * r * 1.1];
        }),
        [-0.5, -0.45],
        [0, -0.6],
        [0.5, -0.45],
      ],
      closed: true,
    },
    {
      name: 'Letter M',
      pts: [
        [-0.9, -0.9],
        [-0.9, 0.9],
        [0, -0.1],
        [0.9, 0.9],
        [0.9, -0.9],
      ],
      closed: false,
    },
  ],
];

export interface Shape {
  name: string;
  /** World points (x, z pairs), from where Babcia starts to where she stops. */
  pts: number[];
  closed: boolean;
  /** Distance along the path at every point. */
  cum: number[];
  len: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Distance along a flat polyline at every point. */
export function cumulative(pts: number[]): number[] {
  const out = [0];
  for (let k = 2; k < pts.length; k += 2) out.push(out[out.length - 1] + Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]));
  return out;
}

/** Make a shape from a template: rotated, maybe mirrored, scaled to its length and placed on the clearing. */
export function buildShape(t: Template, difficulty: Difficulty, rng: Rng): Shape {
  // Closed shapes start at a random corner and come back to it; open ones may be walked either way.
  let pts = t.pts.slice();
  if (t.closed) {
    const s = Math.floor(rng() * pts.length);
    pts = [...pts.slice(s), ...pts.slice(0, s)];
    pts.push(pts[0]);
  } else if (rng() < 0.5) pts.reverse();
  const mirror = rng() < 0.5 ? -1 : 1;
  // A gentle tilt keeps it recognisable (a star still looks like a star).
  const rot = (rng() - 0.5) * 0.7;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // Centre the shape on its bounding box; y up on the TV is -z in the world.
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const turned = pts.map(([x, y]) => {
    const mx = x * mirror;
    const rx = mx * c - y * s;
    const ry = mx * s + y * c;
    x0 = Math.min(x0, rx);
    x1 = Math.max(x1, rx);
    y0 = Math.min(y0, ry);
    y1 = Math.max(y1, ry);
    return [rx, ry];
  });
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const unit: number[] = [];
  for (const [x, y] of turned) unit.push(x - cx, -(y - cy));
  const unitLen = cumulative(unit).at(-1)!;
  let reach = 0;
  for (let k = 0; k < unit.length; k += 2) reach = Math.max(reach, Math.hypot(unit[k], unit[k + 1]));
  const scale = Math.min(TARGET_LEN[difficulty] / unitLen, SHAPE_R / reach);
  // A little off-centre, as long as it stays on the clearing.
  const room = Math.max(0, SHAPE_R + 1 - reach * scale);
  const ox = (rng() - 0.5) * 2 * Math.min(2, room);
  const oz = (rng() - 0.5) * 2 * Math.min(1.2, room);
  const world = unit.map((v, k) => v * scale + (k % 2 ? oz : ox));
  const cum = cumulative(world);
  return { name: t.name, pts: world, closed: t.closed, cum, len: cum[cum.length - 1] };
}

/** A random shape of a difficulty (avoiding the names in `skip`, so a game doesn't repeat itself). */
export function makeShape(difficulty: Difficulty, rng: Rng, skip: string[] = []): Shape {
  const pool = SHAPES[difficulty].filter((t) => !skip.includes(t.name));
  const list = pool.length ? pool : SHAPES[difficulty];
  return buildShape(list[Math.floor(rng() * list.length)], difficulty, rng);
}

/** The point at a distance along a shape, and the direction there. */
export function pointAt(shape: Shape, d: number): { x: number; z: number; fx: number; fz: number } {
  const { pts, cum } = shape;
  const dd = clamp(d, 0, shape.len);
  let k = 1;
  while (k < cum.length - 1 && cum[k] < dd) k++;
  const a = cum[k - 1];
  const seg = cum[k] - a || 1;
  const u = clamp((dd - a) / seg, 0, 1);
  const ax = pts[(k - 1) * 2];
  const az = pts[(k - 1) * 2 + 1];
  const bx = pts[k * 2];
  const bz = pts[k * 2 + 1];
  const l = Math.hypot(bx - ax, bz - az) || 1;
  return { x: ax + (bx - ax) * u, z: az + (bz - az) * u, fx: (bx - ax) / l, fz: (bz - az) / l };
}

/** Points every `step` metres along a flat polyline (both ends included). */
export function resample(pts: number[], step: number): number[] {
  if (pts.length < 2) return [];
  if (pts.length < 4) return pts.slice(0, 2);
  const out = [pts[0], pts[1]];
  let carry = 0;
  for (let k = 2; k < pts.length; k += 2) {
    const ax = pts[k - 2];
    const az = pts[k - 1];
    const dx = pts[k] - ax;
    const dz = pts[k + 1] - az;
    const l = Math.hypot(dx, dz);
    let d = step - carry;
    while (d <= l) {
      out.push(ax + (dx * d) / l, az + (dz * d) / l);
      d += step;
    }
    carry = l - (d - step);
  }
  const lx = pts[pts.length - 2];
  const lz = pts[pts.length - 1];
  if (Math.hypot(out[out.length - 2] - lx, out[out.length - 1] - lz) > 1e-6) out.push(lx, lz);
  return out;
}

/** Distance from a point to a flat polyline (a single point counts as a polyline too). */
export function distToLine(px: number, pz: number, pts: number[]): number {
  if (pts.length < 2) return Infinity;
  if (pts.length < 4) return Math.hypot(px - pts[0], pz - pts[1]);
  let best = Infinity;
  for (let k = 2; k < pts.length; k += 2) {
    const ax = pts[k - 2];
    const az = pts[k - 1];
    const dx = pts[k] - ax;
    const dz = pts[k + 1] - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
    const d = Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
    if (d < best) best = d;
  }
  return best;
}

/** The root-mean-square distance from points along `from` to the line `to` (big misses count extra). */
export function rmsDist(from: number[], to: number[]): number {
  const s = resample(from, SAMPLE);
  if (!s.length) return Infinity;
  let sum = 0;
  for (let k = 0; k < s.length; k += 2) sum += distToLine(s[k], s[k + 1], to) ** 2;
  return Math.sqrt(sum / (s.length / 2));
}

/**
 * How well a trail copies Babcia's, 0–100. Both ways round: how far your steps strayed from her trail
 * (so wandering off costs), and how far her trail is from your steps (so cutting it short costs).
 */
export function accuracy(shape: number[], trail: number[]): number {
  if (trail.length < 4) return 0;
  const d = rmsDist(trail, shape) + rmsDist(shape, trail);
  if (!Number.isFinite(d)) return 0;
  return Math.round(100 / (1 + (d / TOL) ** 2));
}

export interface FootInput {
  /** Joystick, -1..1 each; +x right, +z towards the viewer. */
  x: number;
  z: number;
  /** Pressed Done since the last step. */
  done?: boolean;
}

export interface Walker {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing (unit vector). */
  fx: number;
  fz: number;
  /** How far the stick is pushed (0..1), for walking animations. */
  speed: number;
  /** Footprints so far (x, z pairs), from the first step. */
  trail: number[];
  /** Said they're finished: they stop and their trail is final. */
  done: boolean;
  alive: boolean;
  /** 0–100 once the round is over, else -1. */
  acc: number;
}

export type FootPhase = 'show' | 'trace' | 'end';

export type FootEvent =
  | { t: 'walk' }
  | { t: 'go' }
  | { t: 'fade' }
  | { t: 'gone' }
  | { t: 'done'; p: number }
  | { t: 'end' };

export interface FootOptions {
  rng?: Rng;
  difficulty?: Difficulty;
  /** A ready-made shape (tests). */
  shape?: Shape;
  /** Shape names already walked this game. */
  skip?: string[];
}

export class FootstepsSim {
  readonly n: number;
  readonly difficulty: Difficulty;
  readonly shape: Shape;
  readonly speed: number;
  /** Seconds of watching Babcia, then of walking it yourselves. */
  readonly showS: number;
  readonly traceS: number;
  readonly holdS: number;
  phase: FootPhase = 'show';
  /** Seconds since the round started, and since the players were let go. */
  time = 0;
  traceT = 0;
  /** Babcia: where she is, which way she faces, how far along the trail she's got and whether she's walking. */
  bx: number;
  bz: number;
  bfx = 0;
  bfz = 1;
  bdist = 0;
  bwalk = false;
  readonly players: Walker[] = [];
  private faded = false;
  private gone = false;
  private events: FootEvent[] = [];

  constructor(n: number, opts: FootOptions = {}) {
    const rng = opts.rng ?? Math.random;
    this.n = n;
    this.difficulty = opts.difficulty ?? 0;
    this.shape = opts.shape ?? makeShape(this.difficulty, rng, opts.skip);
    this.speed = BABCIA_SPEED[this.difficulty];
    this.showS = START_PAUSE + this.shape.len / this.speed + END_PAUSE;
    this.traceS = Math.round((this.shape.len / WALK) * TRACE_SLACK + TRACE_EXTRA);
    this.holdS = HOLD_S[this.difficulty];
    const start = pointAt(this.shape, 0);
    this.bx = start.x;
    this.bz = start.z;
    this.bfx = start.fx;
    this.bfz = start.fz;
    // Everyone waits round where Babcia starts, facing the way she's about to go.
    for (let i = 0; i < n; i++) {
      const a = n > 1 ? (i / n) * Math.PI * 2 : 0;
      const r = n > 1 ? 0.7 : 0;
      this.players.push({
        x: start.x + Math.cos(a) * r,
        z: start.z + Math.sin(a) * r,
        vx: 0,
        vz: 0,
        fx: start.fx,
        fz: start.fz,
        speed: 0,
        trail: [],
        done: false,
        alive: true,
        acc: -1,
      });
    }
  }

  get done() {
    return this.phase === 'end';
  }
  /** Seconds left to walk (the whole walking time while Babcia's still showing). */
  get left() {
    return this.phase === 'show' ? this.traceS : Math.max(0, this.traceS - this.traceT);
  }

  /** How much of Babcia's trail shows: 1 while she walks and for a moment after, then down to 0 as the snow covers it. */
  trailShown(): number {
    if (this.phase === 'show') return 1;
    if (this.phase === 'end') return 0;
    return clamp(1 - (this.traceT - this.holdS) / FADE_S, 0, 1);
  }

  /** How far along the trail the berries go (all of it once she's done). */
  get laid() {
    return this.phase === 'show' ? this.bdist : this.shape.len;
  }

  scores() {
    return this.players.map((p) => (p.alive ? Math.max(0, p.acc) : 0));
  }

  /** Most accurate first (then join order). */
  ranking() {
    const s = this.scores();
    return this.players
      .map((p, i) => ({ p, i }))
      .filter((x) => x.p.alive)
      .sort((a, b) => s[b.i] - s[a.i] || a.i - b.i)
      .map((x) => x.i);
  }

  remove(i: number) {
    const p = this.players[i];
    if (!p || !p.alive) return;
    p.alive = false;
    p.trail = [];
    if (this.phase === 'trace' && this.players.every((q) => !q.alive || q.done)) this.finish();
  }

  step(inputs: (FootInput | undefined)[]): FootEvent[] {
    const ev = (this.events = []);
    if (this.phase === 'end') return ev;
    this.time += DT;
    if (this.phase === 'show') this.stepShow();
    else this.stepTrace(inputs);
    return ev;
  }

  private stepShow() {
    const t = this.time - START_PAUSE;
    if (t > 0 && !this.bwalk && this.bdist === 0) {
      this.bwalk = true;
      this.events.push({ t: 'walk' });
    }
    if (t > 0) {
      this.bdist = Math.min(this.shape.len, t * this.speed);
      const p = pointAt(this.shape, this.bdist);
      this.bx = p.x;
      this.bz = p.z;
      this.bfx = p.fx;
      this.bfz = p.fz;
      if (this.bdist >= this.shape.len) this.bwalk = false;
    }
    if (this.time >= this.showS) {
      this.phase = 'trace';
      this.traceT = 0;
      this.events.push({ t: 'go' });
    }
  }

  private stepTrace(inputs: (FootInput | undefined)[]) {
    this.traceT += DT;
    // Babcia steps off to the edge of the clearing to watch.
    const dx = WATCH_X - this.bx;
    const dz = WATCH_Z - this.bz;
    const d = Math.hypot(dx, dz);
    this.bwalk = d > 1e-6;
    if (d <= this.speed * DT) {
      this.bx = WATCH_X;
      this.bz = WATCH_Z;
    } else {
      this.bfx = dx / d;
      this.bfz = dz / d;
      this.bx += this.bfx * this.speed * DT;
      this.bz += this.bfz * this.speed * DT;
    }
    if (!this.bwalk) {
      // Facing the players.
      this.bfx = 0.6;
      this.bfz = 0.8;
    }
    for (let i = 0; i < this.n; i++) this.control(i, inputs[i]);
    const shown = this.trailShown();
    if (!this.faded && shown < 1) {
      this.faded = true;
      this.events.push({ t: 'fade' });
    }
    if (!this.gone && shown <= 0) {
      this.gone = true;
      this.events.push({ t: 'gone' });
    }
    if (this.traceT >= this.traceS || this.players.every((p) => !p.alive || p.done)) this.finish();
  }

  private control(i: number, inp: FootInput = { x: 0, z: 0 }) {
    const p = this.players[i];
    if (!p.alive || p.done) return;
    if (inp.done && p.trail.length >= 4) {
      this.stop(p);
      this.events.push({ t: 'done', p: i });
      return;
    }
    let mx = Number(inp.x) || 0;
    let mz = Number(inp.z) || 0;
    let mag = Math.hypot(mx, mz);
    if (mag > 1) {
      mx /= mag;
      mz /= mag;
      mag = 1;
    }
    if (mag < DEADZONE) mx = mz = mag = 0;
    p.speed = mag;
    const tx = mx * WALK;
    const tz = mz * WALK;
    const dvx = tx - p.vx;
    const dvz = tz - p.vz;
    const dl = Math.hypot(dvx, dvz);
    const step = ACCEL * DT;
    if (dl <= step) {
      p.vx = tx;
      p.vz = tz;
    } else {
      p.vx += (dvx / dl) * step;
      p.vz += (dvz / dl) * step;
    }
    if (mag > 0) {
      p.fx = mx / mag;
      p.fz = mz / mag;
    }
    if (p.vx === 0 && p.vz === 0) return;
    // The first step puts the pen down where you stood.
    if (!p.trail.length) p.trail.push(p.x, p.z);
    p.x += p.vx * DT;
    p.z += p.vz * DT;
    const r = Math.hypot(p.x, p.z);
    const max = ARENA_R - PLAYER_R;
    if (r > max) {
      p.x *= max / r;
      p.z *= max / r;
    }
    this.footprint(p, false);
  }

  /** Record a footprint once you're DOT_GAP from the last one (or always, at the very end). */
  private footprint(p: Walker, last: boolean) {
    const t = p.trail;
    if (!t.length || t.length >= MAX_DOTS * 2) return;
    const d = Math.hypot(p.x - t[t.length - 2], p.z - t[t.length - 1]);
    if (d >= DOT_GAP || (last && d > 0.02)) t.push(p.x, p.z);
  }

  private stop(p: Walker) {
    p.done = true;
    p.vx = p.vz = 0;
    p.speed = 0;
    this.footprint(p, true);
  }

  private finish() {
    if (this.phase === 'end') return;
    this.phase = 'end';
    this.bwalk = false;
    for (const p of this.players) {
      if (!p.alive) continue;
      if (!p.done) this.stop(p);
      p.acc = accuracy(this.shape.pts, p.trail);
    }
    this.events.push({ t: 'end' });
  }
}

/** Difficulty of each round: easy, medium, hard (a tournament's single round is a medium one). */
export function difficultyFor(round: number, rounds: number): Difficulty {
  if (rounds === 1) return 1;
  return clamp(round - 1, 0, 2) as Difficulty;
}

export function placeText(place: number) {
  return ['', '1st', '2nd', '3rd'][place] ?? `${place}th`;
}

export function howTo(short: boolean): string[] {
  return [
    'Watch Babcia walk her trail of rowan berries',
    'Then walk it yourself – soon the snow covers her berries',
    short ? 'Closest copy wins · Done when you’re finished' : 'Closest copy wins · 3 rounds, each harder',
  ];
}
