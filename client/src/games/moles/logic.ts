/**
 * Krety: the pure rules. Babcia's vegetable garden is dotted with molehills; moles pop out of them for a
 * moment and duck again. Walk to a hill and Whack! with your wooden spoon: a mole is +1, a golden mole +3,
 * but a hedgehog (jeż) is prickly: −2 and you hop about holding your hand. Swing at another player and
 * you bonk them dizzy for a second. Moles stay up for less time and more come up at once as the round
 * goes on. No DOM and no three.js in here.
 */
import { mulberry32 } from '../rng';

export const DT = 1 / 60;

export const ROUND_S = 45;
export const ROUNDS = 2;
export const ROUNDS_SHORT = 1;

/** Distance between neighbouring molehills, metres. */
export const SPACING = 3.3;
/** How far the hills wander off the neat grid. */
export const JITTER = 0.35;
/** Players walk this far past the outer hills. */
export const MARGIN = 1.6;

export const WALK = 5.6;
export const ACCEL = 55;
export const PLAYER_R = 0.6;
export const DEADZONE = 0.14;

/** The spoon: reach from the player's middle, and the arc (full angle, radians) it sweeps in front. */
export const REACH = 1.2;
export const ARC = (140 * Math.PI) / 180;
/** A critter counts as inside the swing if its hole's edge is in reach. */
export const HOLE_R = 0.45;
/** Standing this close to a hole, the spoon finds it whichever way you face. */
export const UNDERFOOT = 0.55;
export const WHACK_CD = 0.45;
/** A press this long before the spoon is back still counts. */
export const BUFFER = 0.15;
/** Bonked by a spoon: dizzy, can't move or whack. */
export const STUN = 1;
/** Pricked by a hedgehog: hopping about, can't whack. */
export const OUCH = 0.7;

/** A critter rises this long, and sinks this long after its time is up. */
export const RISE = 0.15;
export const SINK = 0.18;
/** How long a whacked critter stays up seeing stars. */
export const DAZE = 0.55;
/** Up-time at the start and at the end of a round, seconds. */
export const UP_START = 1.3;
export const UP_END = 0.8;
/** No hedgehogs in the first seconds (everyone needs a moment to learn the moles). */
export const HEDGEHOG_AFTER = 4;
/** A hole rests this long after its critter has gone. */
export const HOLE_REST = 0.35;

export const POINTS = { mole: 1, gold: 3, hedgehog: -2 } as const;
export type Kind = keyof typeof POINTS;

/** The molehill grid for a number of players. */
export function gridFor(n: number): { cols: number; rows: number } {
  if (n <= 4) return { cols: 4, rows: 4 };
  if (n <= 6) return { cols: 5, rows: 4 };
  return { cols: 5, rows: 5 };
}

/** How long a critter stays up `t` seconds into a round of `length` seconds: 1.3 s, down to 0.8 s. */
export function upTime(t: number, length = ROUND_S) {
  const f = Math.max(0, Math.min(1, t / length));
  return UP_START + (UP_END - UP_START) * f;
}

/** How many critters may be up at once. */
export function maxUp(t: number, n: number, holes: number, length = ROUND_S) {
  const f = Math.max(0, Math.min(1, t / length));
  return Math.max(1, Math.min(holes - 2, 1 + Math.ceil(n / 2) + Math.floor(f * 3)));
}

/** Seconds until the next pop. */
export function popGap(t: number, n: number, length = ROUND_S) {
  const f = Math.max(0, Math.min(1, t / length));
  return (0.8 - 0.4 * f) / (1 + 0.18 * (Math.max(1, n) - 1));
}

/** What pops up: mostly moles, now and then a golden one, and (after the first seconds) hedgehogs. */
export function kindFor(t: number, r: number): Kind {
  if (r < 0.08) return 'gold';
  if (t >= HEDGEHOG_AFTER && r > 0.86) return 'hedgehog';
  return 'mole';
}

export interface Hole {
  x: number;
  z: number;
  /** Seconds until the hole may be used again. */
  rest: number;
}

export interface Critter {
  id: number;
  hole: number;
  kind: Kind;
  /** Seconds since it started rising. */
  age: number;
  /** Seconds it stays up (after rising). */
  up: number;
  /** Who whacked it (-1: nobody yet), and how long ago. */
  by: number;
  hitAge: number;
}

export interface MolesPlayer {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing (unit vector). */
  fx: number;
  fz: number;
  cd: number;
  buf: number;
  stun: number;
  ouch: number;
  /** Seconds since the last swing started (for the spoon animation). */
  swing: number;
  /** How far the stick is pushed, 0..1. */
  speed: number;
  alive: boolean;
  /** Critters whacked this round, by kind. */
  moles: number;
  golds: number;
  hedgehogs: number;
  bonks: number;
}

export interface MolesInput {
  /** Joystick, -1..1 each; +x right, +z towards the viewer. */
  x: number;
  z: number;
  /** Whack pressed since the last step. */
  whack?: boolean;
}

export type MolesEvent =
  | { t: 'pop'; c: Critter }
  | { t: 'duck'; c: Critter }
  | { t: 'gone'; id: number }
  | { t: 'swing'; p: number }
  /** `pts` is what the player's round score actually changed by (a hedgehog can't take it below 0). */
  | { t: 'hit'; p: number; c: Critter; kind: Kind; pts: number; x: number; z: number }
  | { t: 'bonk'; p: number; by: number }
  | { t: 'miss'; p: number }
  | { t: 'over' };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export interface MolesOptions {
  rng?: () => number;
  length?: number;
  cols?: number;
  rows?: number;
  /** false: no random pops (tests pop critters by hand). */
  auto?: boolean;
  /** Seeds where the hills wander off the grid, so every round of a game has the same garden. */
  layout?: number;
}

export class MolesSim {
  readonly n: number;
  readonly cols: number;
  readonly rows: number;
  readonly length: number;
  readonly holes: Hole[] = [];
  readonly players: MolesPlayer[] = [];
  critters: Critter[] = [];
  /** This round's points per player (never below 0). */
  readonly points: number[];
  time = 0;
  started = false;
  over = false;
  private nextPop = 0.6;
  private nextId = 1;
  private events: MolesEvent[] = [];
  private readonly rng: () => number;
  private readonly auto: boolean;

  constructor(n: number, opts: MolesOptions = {}) {
    this.n = n;
    this.rng = opts.rng ?? Math.random;
    this.auto = opts.auto ?? true;
    this.length = opts.length ?? ROUND_S;
    const g = gridFor(n);
    this.cols = opts.cols ?? g.cols;
    this.rows = opts.rows ?? g.rows;
    const lay = opts.layout !== undefined ? mulberry32(opts.layout) : this.rng;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const jx = (lay() - 0.5) * 2 * JITTER;
        const jz = (lay() - 0.5) * 2 * JITTER;
        this.holes.push({ x: (c - (this.cols - 1) / 2) * SPACING + jx, z: (r - (this.rows - 1) / 2) * SPACING + jz, rest: 0 });
      }
    this.points = Array.from({ length: n }, () => 0);
    // Players start in a row along the front of the garden, between the hills, facing in.
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : (i / (n - 1) - 0.5) * Math.min(this.W - 1, n * 1.7);
      this.players.push({
        x,
        z: this.H / 2 - 0.2,
        vx: 0,
        vz: 0,
        fx: 0,
        fz: -1,
        cd: 0,
        buf: 0,
        stun: 0,
        ouch: 0,
        swing: 99,
        speed: 0,
        alive: true,
        moles: 0,
        golds: 0,
        hedgehogs: 0,
        bonks: 0,
      });
    }
  }

  /** Width and depth of the walkable garden. */
  get W() {
    return (this.cols - 1) * SPACING + MARGIN * 2;
  }
  get H() {
    return (this.rows - 1) * SPACING + MARGIN * 2;
  }
  get left() {
    return Math.max(0, this.length - this.time);
  }
  get solo() {
    return this.n === 1;
  }

  begin() {
    this.started = true;
  }

  /** A player leaves for good. */
  remove(i: number) {
    const p = this.players[i];
    if (!p) return;
    p.alive = false;
    p.vx = p.vz = 0;
  }

  /** Is critter `c` out of its hole and whackable? */
  whackable(c: Critter) {
    return c.by < 0 && c.age >= RISE * 0.4 && c.age < RISE + c.up + SINK * 0.5;
  }

  /** Pop a critter out of hole `h` (used by the random schedule, and by tests). */
  pop(h: number, kind: Kind, up = upTime(this.time, this.length)): Critter | null {
    const hole = this.holes[h];
    if (!hole || this.critters.some((c) => c.hole === h)) return null;
    const c: Critter = { id: this.nextId++, hole: h, kind, age: 0, up: kind === 'hedgehog' ? up * 1.15 : up, by: -1, hitAge: 0 };
    this.critters.push(c);
    this.events.push({ t: 'pop', c });
    return c;
  }

  /** Round results: points, and the winners (empty if nobody scored). */
  results() {
    const live = this.players.map((p, i) => (p.alive ? i : -1)).filter((i) => i >= 0);
    const best = Math.max(0, ...live.map((i) => this.points[i]));
    return { points: this.points.slice(), winners: best > 0 ? live.filter((i) => this.points[i] === best) : [] };
  }

  /** Live players, most points first (ties keep join order). */
  ranking() {
    return this.players
      .map((p, i) => ({ p, i }))
      .filter((x) => x.p.alive)
      .sort((a, b) => this.points[b.i] - this.points[a.i] || a.i - b.i)
      .map((x) => x.i);
  }

  step(inputs: (MolesInput | undefined)[]): MolesEvent[] {
    this.events = [];
    const ev = this.events;
    if (this.over) return ev;
    if (this.started) this.time += DT;
    for (const h of this.holes) h.rest = Math.max(0, h.rest - DT);
    this.tickCritters();
    if (this.started && this.auto) this.schedule();
    for (let i = 0; i < this.n; i++) this.control(i, this.started ? inputs[i] : { x: inputs[i]?.x ?? 0, z: inputs[i]?.z ?? 0 });
    this.collide();
    if (this.started && this.time >= this.length) {
      this.over = true;
      for (const c of this.critters) ev.push({ t: 'gone', id: c.id });
      this.critters = [];
      ev.push({ t: 'over' });
    }
    return ev;
  }

  private schedule() {
    if (this.time < this.nextPop) return;
    this.nextPop = this.time + popGap(this.time, this.n, this.length) * (0.7 + this.rng() * 0.6);
    // Don't start critters that couldn't finish before the whistle.
    if (this.time > this.length - 0.5) return;
    const up = this.critters.filter((c) => c.by < 0).length;
    if (up >= maxUp(this.time, this.n, this.holes.length, this.length)) return;
    const free = this.holes.map((_, k) => k).filter((k) => this.holes[k].rest <= 0 && !this.critters.some((c) => c.hole === k));
    if (!free.length) return;
    const h = free[Math.floor(this.rng() * free.length)];
    this.pop(h, kindFor(this.time, this.rng()));
  }

  private tickCritters() {
    for (let k = this.critters.length - 1; k >= 0; k--) {
      const c = this.critters[k];
      const wasUp = c.age < RISE + c.up;
      c.age += DT;
      let gone = false;
      if (c.by >= 0) {
        c.hitAge += DT;
        gone = c.hitAge >= DAZE + SINK;
      } else {
        if (wasUp && c.age >= RISE + c.up) this.events.push({ t: 'duck', c });
        gone = c.age >= RISE + c.up + SINK;
      }
      if (gone) {
        this.critters.splice(k, 1);
        this.holes[c.hole].rest = HOLE_REST;
        this.events.push({ t: 'gone', id: c.id });
      }
    }
  }

  private control(i: number, inp: MolesInput = { x: 0, z: 0 }) {
    const p = this.players[i];
    if (!p.alive) return;
    p.cd = Math.max(0, p.cd - DT);
    p.buf = Math.max(0, p.buf - DT);
    p.swing += DT;
    if (inp.whack) p.buf = BUFFER;
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
    if (p.stun > 0) {
      p.stun = Math.max(0, p.stun - DT);
      p.buf = 0;
      const k = Math.exp(-6 * DT);
      p.vx *= k;
      p.vz *= k;
    } else {
      // Pricked: hop about slowly, no whacking.
      const walk = p.ouch > 0 ? WALK * 0.35 : WALK;
      if (p.ouch > 0) {
        p.ouch = Math.max(0, p.ouch - DT);
        p.buf = 0;
      }
      const tx = mx * walk;
      const tz = mz * walk;
      const dvx = tx - p.vx;
      const dvz = tz - p.vz;
      const dl = Math.hypot(dvx, dvz);
      const st = ACCEL * DT;
      if (dl <= st) {
        p.vx = tx;
        p.vz = tz;
      } else {
        p.vx += (dvx / dl) * st;
        p.vz += (dvz / dl) * st;
      }
      if (mag > 0) {
        p.fx = mx / mag;
        p.fz = mz / mag;
      }
      if (p.buf > 0 && p.cd <= 0 && this.started && !this.over) this.whack(i);
    }
    p.x += p.vx * DT;
    p.z += p.vz * DT;
    p.x = clamp(p.x, -this.W / 2, this.W / 2);
    p.z = clamp(p.z, -this.H / 2, this.H / 2);
  }

  /** Is the point (x, z), with radius `r`, inside player i's swing? */
  inSwing(i: number, x: number, z: number, r = 0) {
    const p = this.players[i];
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.hypot(dx, dz);
    if (d - r > REACH) return false;
    if (d <= UNDERFOOT) return true;
    const cos = (dx * p.fx + dz * p.fz) / d;
    return Math.acos(clamp(cos, -1, 1)) <= ARC / 2;
  }

  /** Swing the spoon: the nearest critter in the arc gets whacked, and so does any player in it. */
  whack(i: number) {
    const p = this.players[i];
    p.cd = WHACK_CD;
    p.buf = 0;
    p.swing = 0;
    this.events.push({ t: 'swing', p: i });
    let best: Critter | null = null;
    let bestD = Infinity;
    for (const c of this.critters) {
      if (!this.whackable(c)) continue;
      const h = this.holes[c.hole];
      if (!this.inSwing(i, h.x, h.z, HOLE_R)) continue;
      const d = Math.hypot(h.x - p.x, h.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    let any = false;
    if (best) {
      any = true;
      const c = best;
      c.by = i;
      c.hitAge = 0;
      const before = this.points[i];
      this.points[i] = Math.max(0, before + POINTS[c.kind]);
      if (c.kind === 'mole') p.moles++;
      else if (c.kind === 'gold') p.golds++;
      else {
        p.hedgehogs++;
        p.ouch = OUCH;
      }
      const h = this.holes[c.hole];
      this.events.push({ t: 'hit', p: i, c, kind: c.kind, pts: this.points[i] - before, x: h.x, z: h.z });
    }
    for (let j = 0; j < this.n; j++) {
      const o = this.players[j];
      if (j === i || !o.alive || o.stun > 0) continue;
      if (!this.inSwing(i, o.x, o.z, PLAYER_R)) continue;
      any = true;
      o.stun = STUN;
      o.ouch = 0;
      const d = Math.hypot(o.x - p.x, o.z - p.z) || 1;
      o.vx = ((o.x - p.x) / d) * 4;
      o.vz = ((o.z - p.z) / d) * 4;
      p.bonks++;
      this.events.push({ t: 'bonk', p: j, by: i });
    }
    if (!any) this.events.push({ t: 'miss', p: i });
  }

  /** Soft circles: overlapping players are pushed apart. */
  private collide() {
    for (let i = 0; i < this.n; i++) {
      const a = this.players[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.n; j++) {
        const b = this.players[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = PLAYER_R * 2;
        if (d >= min) continue;
        const nx = d > 1e-6 ? dx / d : 1;
        const nz = d > 1e-6 ? dz / d : 0;
        const push = (min - d) / 2;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
      }
    }
  }
}

export function howTo(short: boolean): string[] {
  return ['Walk to a molehill and Whack! the mole', 'Mole +1 · golden mole +3 · hedgehog −2', short ? 'Most points after 45 seconds wins' : 'Most points after 2 × 45 seconds wins'];
}
