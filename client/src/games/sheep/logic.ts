/**
 * Owieczki ("little sheep"): the pure rules. No DOM, no three.js.
 *
 * A highland meadow in Podhale, fenced in as an ellipse. Round its edge every player has a small
 * wooden pen with its gate facing the middle. A flock of sheep grazes in the middle and moves like
 * a flock (separation, cohesion, alignment and a little wander); the players are the sheepdogs:
 * sheep run away from anyone who comes close. A sheep that walks through a gate into a pen is
 * counted for that pen's owner and stays there for the rest of the round (white 1, black 3).
 * Whistle scares every free sheep within WHISTLE_R away from you. When the flock gets small, new
 * sheep wander in from the shepherd's hut (bacówka) at the top of the meadow.
 *
 * World units are metres, y is up; the meadow is centred on the origin, +x right, +z towards the
 * camera (the TV viewer). The hut stands behind the far fence (-z).
 */
import { mulberry32, type Rng } from '../rng';

export { mulberry32 };
export type { Rng };

export const DT = 1 / 60;

export const ROUND_S = 75;
export const ROUNDS = 2;
export const ROUNDS_SHORT = 1;

// ---- the meadow --------------------------------------------------------------------------------
/** Half axes of the fenced meadow (an ellipse). */
export const RX = 17;
export const RZ = 10;
/** Pens: width along the fence, depth into it, and the gate's width. */
export const PEN_W = 4;
export const PEN_D = 3.2;
export const GATE_W = 2.4;
/** Gap between a pen's back wall and the meadow fence. */
export const PEN_GAP = 0.25;
/** A sheep this far past the gate line is in the pen. */
export const CAPTURE_U = 0.45;
/** The hut behind the far fence, and the half-width of the fence gap its sheep come through. */
export const HUT = { x: 0, z: -(RZ + 3.4) };
export const GAP_HALF = 1.4;
/** Boulders in the meadow (sheep and dogs go round them). */
export const ROCKS: readonly { x: number; z: number; r: number }[] = [
  { x: -6.6, z: -2.4, r: 0.95 },
  { x: 7.2, z: 1.9, r: 0.75 },
];

// ---- players ------------------------------------------------------------------------------------
export const PLAYER_R = 0.75;
export const WALK = 6.5;
export const ACCEL = 38;
export const DEADZONE = 0.14;
/** Bumping: how bouncy, and the least speed it takes to count as a bump. */
export const BUMP_E = 0.6;
export const BUMP_MIN = 2;

export const WHISTLE_R = 5;
export const WHISTLE_CD = 3;
/** A press this long before the whistle is ready still counts. */
export const BUFFER = 0.25;
/** Whistled-at sheep run flat out for this long, and get this kick away from you. */
export const WHISTLE_PANIC = 1.3;
export const WHISTLE_KICK = 5;

// ---- sheep --------------------------------------------------------------------------------------
export const SHEEP_R = 0.42;
/** Sheep notice a dog this close and run from it. */
export const FLEE_R = 4.5;
export const CALM_SPEED = 0.9;
export const FLEE_SPEED = 4.2;
export const PANIC_SPEED = 5.4;
export const GRAZE_SPEED = 0.12;
export const PEN_SPEED = 0.6;
export const ENTER_SPEED = 1.7;
export const SEP_R = 1.2;
export const NEIGH_R = 4;
/** Sheep steer away from the fence beyond this fraction of the ellipse. */
export const EDGE_Q = 0.84;

const W_SEP = 6;
const W_COH = 0.5;
const W_ALIGN = 0.8;
const W_WANDER = 0.7;
const W_FLEE = 14;
const W_PANIC = 10;
const W_EDGE = 12;
const W_HOME = 0.25;
const W_ROCK = 6;
const DRAG = 1.6;

export const WHITE_PTS = 1;
export const BLACK_PTS = 3;
/** At most this many sheep in a round, penned ones included. */
export const MAX_SHEEP = 72;
/** One new sheep from the hut every SPAWN_GAP seconds while the flock is small. */
export const SPAWN_GAP = 0.6;
/** Chance a sheep from the hut is black. */
export const BLACK_CHANCE = 0.15;

/** Sheep in the meadow at the start. */
export const flockSize = (n: number) => Math.min(26, 11 + 2 * Math.max(1, n));
/** New sheep come in from the hut while fewer than this many are free. */
export const minFlock = (n: number) => Math.round(flockSize(n) * 0.5);
/** Black sheep in the starting flock. */
export const blackStart = (n: number) => Math.min(4, 2 + Math.floor(Math.max(1, n) / 3));

export const sheepValue = (black: boolean) => (black ? BLACK_PTS : WHITE_PTS);

/** How far out a point is: 0 in the middle, 1 on an ellipse with half axes rx, rz. */
export const ellipseQ = (x: number, z: number, rx = RX, rz = RZ) => Math.hypot(x / rx, z / rz);

// ---- pens ---------------------------------------------------------------------------------------
export interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

export interface Pen {
  owner: number;
  /** Middle of the gate line. */
  x: number;
  z: number;
  /** Outward normal (from the gate towards the back wall) and the lateral axis. */
  nx: number;
  nz: number;
  lx: number;
  lz: number;
  /** Its owner left: the gate is shut, nothing more gets in. */
  closed: boolean;
  /** Sheep in the pen, and what they are worth. */
  count: number;
  points: number;
  black: number;
  walls: Seg[];
}

/** Where the pens go for n players: evenly round the fence (by arc length), leaving the hut's slot at the top. */
export function penLayout(n: number): Pen[] {
  const N = 720;
  const pts: { x: number; z: number; t: number; s: number }[] = [];
  let s = 0;
  for (let k = 0; k <= N; k++) {
    const t = -Math.PI / 2 + (k / N) * Math.PI * 2;
    const x = RX * Math.cos(t);
    const z = RZ * Math.sin(t);
    if (k > 0) s += Math.hypot(x - pts[k - 1].x, z - pts[k - 1].z);
    pts.push({ x, z, t, s });
  }
  const L = s;
  const pens: Pen[] = [];
  for (let i = 0; i < n; i++) {
    const want = (L * (i + 1)) / (n + 1);
    let k = 0;
    while (k < N && pts[k].s < want) k++;
    const p = pts[k];
    let nx = Math.cos(p.t) / RX;
    let nz = Math.sin(p.t) / RZ;
    const len = Math.hypot(nx, nz);
    nx /= len;
    nz /= len;
    const depth = PEN_D + PEN_GAP;
    const pen: Pen = { owner: i, x: p.x - nx * depth, z: p.z - nz * depth, nx, nz, lx: -nz, lz: nx, closed: false, count: 0, points: 0, black: 0, walls: [] };
    pen.walls = penWalls(pen, false);
    pens.push(pen);
  }
  return pens;
}

/** A point in a pen's own frame: u from the gate line inwards (towards the back), v along the gate. */
export function penLocal(pen: Pen, x: number, z: number) {
  const dx = x - pen.x;
  const dz = z - pen.z;
  return { u: dx * pen.nx + dz * pen.nz, v: dx * pen.lx + dz * pen.lz };
}

export function penWorld(pen: Pen, u: number, v: number) {
  return { x: pen.x + pen.nx * u + pen.lx * v, z: pen.z + pen.nz * u + pen.lz * v };
}

function penWalls(pen: Pen, closed: boolean): Seg[] {
  const hw = PEN_W / 2;
  const gw = GATE_W / 2;
  const seg = (u1: number, v1: number, u2: number, v2: number): Seg => {
    const a = penWorld(pen, u1, v1);
    const b = penWorld(pen, u2, v2);
    return { ax: a.x, az: a.z, bx: b.x, bz: b.z };
  };
  const walls = [seg(0, -hw, PEN_D, -hw), seg(PEN_D, -hw, PEN_D, hw), seg(PEN_D, hw, 0, hw), seg(0, -hw, 0, -gw), seg(0, gw, 0, hw)];
  if (closed) walls.push(seg(0, -gw, 0, gw));
  return walls;
}

// ---- the sim ------------------------------------------------------------------------------------
export interface SheepInput {
  /** Joystick, -1..1 each; +x right, +z towards the viewer. */
  x: number;
  z: number;
  /** A press of Whistle since the last step. */
  whistle?: boolean;
}

export interface Dog {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing (unit vector). */
  fx: number;
  fz: number;
  /** Seconds until the whistle is ready again. */
  cd: number;
  buf: number;
  /** How far the stick is pushed (0..1), for the walk animation. */
  speed: number;
  /** False once the player has left. */
  alive: boolean;
  whistles: number;
}

export type SheepState = 'enter' | 'free' | 'penned';

export interface Sheep {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  black: boolean;
  state: SheepState;
  /** The pen it's in (-1 while free). */
  pen: number;
  /** 0..1: how scared it is right now. */
  alert: number;
  /** Seconds of whistle panic left, and where the whistle came from. */
  panic: number;
  px: number;
  pz: number;
  /** Wander heading. */
  w: number;
  grazing: boolean;
  graze: number;
}

export type SheepEvent =
  | { t: 'pen'; id: number; pen: number; value: number; black: boolean; x: number; z: number }
  | { t: 'whistle'; p: number; x: number; z: number; scared: number }
  | { t: 'spawn'; id: number; black: boolean }
  | { t: 'bump'; a: number; b: number; x: number; z: number; force: number }
  | { t: 'spook'; id: number };

export interface SheepOptions {
  rng?: Rng;
  short?: boolean;
  /** Round length in seconds. */
  length?: number;
  /** Starting flock (default flockSize(n)) and how many of them are black. */
  flock?: number;
  black?: number;
  /** New sheep from the hut when the flock gets small (default on). */
  respawn?: boolean;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class SheepSim {
  readonly n: number;
  readonly length: number;
  readonly pens: Pen[];
  readonly dogs: Dog[] = [];
  readonly sheep: Sheep[] = [];
  readonly minFlock: number;
  time = 0;
  /** Sheep that came in from the hut this round. */
  spawned = 0;
  private nextId = 1;
  private spawnT = 0;
  private readonly respawn: boolean;
  private readonly rng: Rng;
  private events: SheepEvent[] = [];

  constructor(n: number, opts: SheepOptions = {}) {
    this.n = n;
    this.rng = opts.rng ?? Math.random;
    this.length = opts.length ?? ROUND_S;
    this.respawn = opts.respawn ?? true;
    this.minFlock = minFlock(n);
    this.pens = penLayout(n);
    for (const pen of this.pens) {
      // Each dog starts in front of its own gate, facing the flock.
      const s = penWorld(pen, -1.9, 0);
      this.dogs.push({ x: s.x, z: s.z, vx: 0, vz: 0, fx: -pen.nx, fz: -pen.nz, cd: 0, buf: 0, speed: 0, alive: true, whistles: 0 });
    }
    const count = opts.flock ?? flockSize(n);
    const blacks = Math.min(count, opts.black ?? blackStart(n));
    for (let k = 0; k < count; k++) {
      const at = this.freeSpot();
      this.addSheep(at.x, at.z, k < blacks);
    }
  }

  get done() {
    return this.time >= this.length;
  }
  get left() {
    return Math.max(0, this.length - this.time);
  }
  /** Sheep still roaming (or walking in from the hut). */
  get freeCount() {
    return this.sheep.filter((s) => s.state !== 'penned').length;
  }

  /** Points per player this round (sheep in their pen). */
  scores() {
    return this.pens.map((p) => p.points);
  }

  /** Players still in, most points first (ties keep join order). */
  ranking() {
    return this.pens
      .filter((p) => this.dogs[p.owner].alive)
      .sort((a, b) => b.points - a.points || a.owner - b.owner)
      .map((p) => p.owner);
  }

  /** A random spot in the middle of the meadow, clear of rocks and other sheep. */
  private freeSpot() {
    let best = { x: 0, z: 0 };
    let bestD = -1;
    for (let k = 0; k < 24; k++) {
      const a = this.rng() * Math.PI * 2;
      const r = Math.sqrt(this.rng()) * 0.42;
      const x = Math.cos(a) * r * RX;
      const z = Math.sin(a) * r * RZ;
      if (ROCKS.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + SHEEP_R + 0.3)) continue;
      let d = 99;
      for (const s of this.sheep) d = Math.min(d, Math.hypot(s.x - x, s.z - z));
      if (d > bestD) {
        bestD = d;
        best = { x, z };
      }
      if (d > 1.4) break;
    }
    return best;
  }

  /** Put a free sheep in the meadow (tests and the starting flock). */
  addSheep(x: number, z: number, black = false): Sheep {
    const s: Sheep = {
      id: this.nextId++,
      x,
      z,
      vx: 0,
      vz: 0,
      black,
      state: 'free',
      pen: -1,
      alert: 0,
      panic: 0,
      px: 0,
      pz: 0,
      w: this.rng() * Math.PI * 2,
      grazing: this.rng() < 0.6,
      graze: 0.5 + this.rng() * 3,
    };
    this.sheep.push(s);
    return s;
  }

  /** A player leaves: their dog is gone and their gate shuts. Sheep already inside stay. */
  remove(i: number) {
    const d = this.dogs[i];
    if (!d || !d.alive) return;
    d.alive = false;
    d.vx = d.vz = 0;
    const pen = this.pens[i];
    pen.closed = true;
    pen.walls = penWalls(pen, true);
  }

  // ---- the step -------------------------------------------------------------------------------

  step(inputs: (SheepInput | undefined)[]): SheepEvent[] {
    const ev = (this.events = []);
    this.time += DT;
    for (let i = 0; i < this.n; i++) this.control(i, inputs[i]);
    this.bumpDogs();
    for (const d of this.dogs) if (d.alive) this.confineDog(d);
    this.moveSheep();
    this.collideSheep();
    this.capture();
    this.tickSpawn();
    return ev;
  }

  private control(i: number, inp: SheepInput = { x: 0, z: 0 }) {
    const d = this.dogs[i];
    if (!d.alive) return;
    d.cd = Math.max(0, d.cd - DT);
    d.buf = Math.max(0, d.buf - DT);
    if (inp.whistle) d.buf = BUFFER;
    let mx = Number.isFinite(inp.x) ? Number(inp.x) : 0;
    let mz = Number.isFinite(inp.z) ? Number(inp.z) : 0;
    let mag = Math.hypot(mx, mz);
    if (mag > 1) {
      mx /= mag;
      mz /= mag;
      mag = 1;
    }
    if (mag < DEADZONE) mx = mz = mag = 0;
    d.speed = mag;
    const tx = mx * WALK;
    const tz = mz * WALK;
    const dvx = tx - d.vx;
    const dvz = tz - d.vz;
    const dl = Math.hypot(dvx, dvz);
    const stepV = ACCEL * DT;
    if (dl <= stepV) {
      d.vx = tx;
      d.vz = tz;
    } else {
      d.vx += (dvx / dl) * stepV;
      d.vz += (dvz / dl) * stepV;
    }
    if (mag > 0) {
      d.fx = mx / mag;
      d.fz = mz / mag;
    }
    d.x += d.vx * DT;
    d.z += d.vz * DT;
    if (d.buf > 0 && d.cd <= 0) this.whistle(i);
  }

  /** Whistle: every free sheep within WHISTLE_R bolts away from you. */
  private whistle(i: number) {
    const d = this.dogs[i];
    d.cd = WHISTLE_CD;
    d.buf = 0;
    d.whistles++;
    let scared = 0;
    for (const s of this.sheep) {
      if (s.state === 'penned') continue;
      const dx = s.x - d.x;
      const dz = s.z - d.z;
      const dist = Math.hypot(dx, dz);
      if (dist > WHISTLE_R) continue;
      const ux = dist > 1e-6 ? dx / dist : d.fx;
      const uz = dist > 1e-6 ? dz / dist : d.fz;
      const kick = WHISTLE_KICK * (1 - 0.5 * (dist / WHISTLE_R));
      s.vx += ux * kick;
      s.vz += uz * kick;
      s.panic = WHISTLE_PANIC;
      s.px = d.x;
      s.pz = d.z;
      s.alert = 1;
      s.grazing = false;
      scared++;
    }
    this.events.push({ t: 'whistle', p: i, x: d.x, z: d.z, scared });
  }

  /** Dogs bump off each other softly. */
  private bumpDogs() {
    for (let i = 0; i < this.n; i++) {
      const a = this.dogs[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.n; j++) {
        const b = this.dogs[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        const min = PLAYER_R * 2;
        if (dist >= min) continue;
        const nx = dist > 1e-6 ? dx / dist : 1;
        const nz = dist > 1e-6 ? dz / dist : 0;
        const push = (min - dist) / 2;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
        const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rel < 0) {
          const j2 = (-(1 + BUMP_E) * rel) / 2;
          a.vx -= nx * j2;
          a.vz -= nz * j2;
          b.vx += nx * j2;
          b.vz += nz * j2;
          if (-rel > BUMP_MIN) this.events.push({ t: 'bump', a: i, b: j, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, force: -rel });
        }
      }
    }
  }

  /** Dogs stay on the meadow, out of the pens and off the rocks. */
  private confineDog(d: Dog) {
    for (const pen of this.pens) {
      const { u, v } = penLocal(pen, d.x, d.z);
      const r = PLAYER_R;
      const hw = PEN_W / 2;
      if (u <= -r || u >= PEN_D + r || Math.abs(v) >= hw + r) continue;
      // Inside the pen's footprint: out by the shortest way.
      const outs = [
        { k: u + r, du: -(u + r), dv: 0 },
        { k: PEN_D + r - u, du: PEN_D + r - u, dv: 0 },
        { k: v + hw + r, du: 0, dv: -(v + hw + r) },
        { k: hw + r - v, du: 0, dv: hw + r - v },
      ];
      const o = outs.reduce((a, b) => (b.k < a.k ? b : a));
      d.x += pen.nx * o.du + pen.lx * o.dv;
      d.z += pen.nz * o.du + pen.lz * o.dv;
      const nx = pen.nx * Math.sign(o.du) + pen.lx * Math.sign(o.dv);
      const nz = pen.nz * Math.sign(o.du) + pen.lz * Math.sign(o.dv);
      const into = d.vx * nx + d.vz * nz;
      if (into < 0) {
        d.vx -= nx * into;
        d.vz -= nz * into;
      }
    }
    pushOffRocks(d, PLAYER_R);
    clampEllipse(d, PLAYER_R);
  }

  private moveSheep() {
    const list = this.sheep;
    // Fear spreads through the flock: read last step's alerts.
    const prevAlert = list.map((s) => s.alert);
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      if (s.state === 'enter') {
        this.walkIn(s);
        continue;
      }
      if (s.state === 'penned') {
        this.mill(s);
        continue;
      }
      let ax = 0;
      let az = 0;
      // Dogs.
      let fear = 0;
      for (const d of this.dogs) {
        if (!d.alive) continue;
        const dx = s.x - d.x;
        const dz = s.z - d.z;
        const dist = Math.hypot(dx, dz);
        if (dist >= FLEE_R) continue;
        const f = 1 - dist / FLEE_R;
        fear = Math.max(fear, f);
        const ux = dist > 1e-6 ? dx / dist : 1;
        const uz = dist > 1e-6 ? dz / dist : 0;
        const w = W_FLEE * Math.pow(f, 1.5);
        ax += ux * w;
        az += uz * w;
      }
      if (s.panic > 0) {
        s.panic = Math.max(0, s.panic - DT);
        const dx = s.x - s.px;
        const dz = s.z - s.pz;
        const dist = Math.hypot(dx, dz) || 1;
        ax += (dx / dist) * W_PANIC;
        az += (dz / dist) * W_PANIC;
      }
      // The flock: separation, cohesion, alignment.
      let cx = 0;
      let cz = 0;
      let avx = 0;
      let avz = 0;
      let nb = 0;
      let spread = 0;
      for (let j = 0; j < list.length; j++) {
        if (j === k) continue;
        const o = list[j];
        if (o.state !== 'free') continue;
        const dx = s.x - o.x;
        const dz = s.z - o.z;
        const dist = Math.hypot(dx, dz);
        if (dist >= NEIGH_R) continue;
        nb++;
        cx += o.x;
        cz += o.z;
        avx += o.vx;
        avz += o.vz;
        spread = Math.max(spread, prevAlert[j] * (1 - dist / NEIGH_R));
        if (dist < SEP_R) {
          const ux = dist > 1e-6 ? dx / dist : Math.cos(s.w);
          const uz = dist > 1e-6 ? dz / dist : Math.sin(s.w);
          const w = W_SEP * (1 - dist / SEP_R);
          ax += ux * w;
          az += uz * w;
        }
      }
      const wasCalm = s.alert < 0.15;
      s.alert = Math.max(fear, s.panic > 0 ? 1 : 0, 0.6 * spread, s.alert - 1.2 * DT);
      if (wasCalm && fear > 0.3) this.events.push({ t: 'spook', id: s.id });
      if (nb > 0) {
        let tx = (cx / nb - s.x) * W_COH;
        let tz = (cz / nb - s.z) * W_COH;
        const tl = Math.hypot(tx, tz);
        if (tl > 1.5) {
          tx *= 1.5 / tl;
          tz *= 1.5 / tl;
        }
        ax += tx;
        az += tz;
        const wa = W_ALIGN * (0.3 + s.alert);
        ax += (avx / nb - s.vx) * wa;
        az += (avz / nb - s.vz) * wa;
      }
      // Grazing and wandering.
      if (s.alert > 0.3) s.grazing = false;
      s.graze -= DT;
      if (s.graze <= 0) {
        s.grazing = !s.grazing && s.alert < 0.1;
        s.graze = s.grazing ? 2.5 + this.rng() * 3.5 : 1.5 + this.rng() * 2;
      }
      s.w += (this.rng() * 2 - 1) * 3 * DT;
      if (!s.grazing) {
        ax += Math.cos(s.w) * W_WANDER;
        az += Math.sin(s.w) * W_WANDER;
      }
      // The fence, the middle and the rocks.
      const q = ellipseQ(s.x, s.z);
      if (q > EDGE_Q) {
        const gx = s.x / (RX * RX);
        const gz = s.z / (RZ * RZ);
        const gl = Math.hypot(gx, gz) || 1;
        const w = W_EDGE * Math.min(1.5, (q - EDGE_Q) / (1 - EDGE_Q));
        ax -= (gx / gl) * w;
        az -= (gz / gl) * w;
      }
      if (s.alert < 0.3 && q > 0.3) {
        ax -= (s.x / (q * RX)) * W_HOME * q;
        az -= (s.z / (q * RZ)) * W_HOME * q;
      }
      for (const r of ROCKS) {
        const dx = s.x - r.x;
        const dz = s.z - r.z;
        const dist = Math.hypot(dx, dz);
        const reach = r.r + SHEEP_R + 0.9;
        if (dist >= reach || dist < 1e-6) continue;
        const w = W_ROCK * (1 - dist / reach);
        ax += (dx / dist) * w;
        az += (dz / dist) * w;
      }
      s.vx += ax * DT;
      s.vz += az * DT;
      const drag = Math.exp(-DRAG * DT);
      s.vx *= drag;
      s.vz *= drag;
      let max = CALM_SPEED + (FLEE_SPEED - CALM_SPEED) * s.alert;
      if (s.panic > 0) max = PANIC_SPEED;
      else if (s.grazing && s.alert < 0.08) max = GRAZE_SPEED;
      // Right after a whistle the kick may be faster than the cap: let it bleed off instead.
      const sp = Math.hypot(s.vx, s.vz);
      if (sp > max) {
        const k2 = Math.max(max, sp - 9 * DT) / sp;
        s.vx *= k2;
        s.vz *= k2;
      }
      s.x += s.vx * DT;
      s.z += s.vz * DT;
    }
  }

  /** A new sheep walks down from the hut and through the gap in the fence. */
  private walkIn(s: Sheep) {
    const tx = clamp(s.x, -GAP_HALF + SHEEP_R, GAP_HALF - SHEEP_R) * 0.6;
    const tz = -RZ + 2.4;
    const dx = tx - s.x;
    const dz = tz - s.z;
    const dist = Math.hypot(dx, dz) || 1;
    s.vx = (dx / dist) * ENTER_SPEED;
    s.vz = (dz / dist) * ENTER_SPEED;
    s.x += s.vx * DT;
    s.z += s.vz * DT;
    if (s.z > -RZ + 1.3) s.state = 'free';
  }

  /** A penned sheep potters about inside, keeping to the back of the pen. */
  private mill(s: Sheep) {
    const pen = this.pens[s.pen];
    const home = penWorld(pen, PEN_D * 0.62, 0);
    let ax = (home.x - s.x) * 0.6;
    let az = (home.z - s.z) * 0.6;
    for (const o of this.sheep) {
      if (o === s || o.pen !== s.pen) continue;
      const dx = s.x - o.x;
      const dz = s.z - o.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= SEP_R * 0.9) continue;
      const ux = dist > 1e-6 ? dx / dist : Math.cos(s.w);
      const uz = dist > 1e-6 ? dz / dist : Math.sin(s.w);
      const w = W_SEP * (1 - dist / (SEP_R * 0.9));
      ax += ux * w;
      az += uz * w;
    }
    s.w += (this.rng() * 2 - 1) * 2 * DT;
    ax += Math.cos(s.w) * 0.3;
    az += Math.sin(s.w) * 0.3;
    s.alert = Math.max(0, s.alert - 1.2 * DT);
    s.panic = 0;
    s.vx = (s.vx + ax * DT) * Math.exp(-3 * DT);
    s.vz = (s.vz + az * DT) * Math.exp(-3 * DT);
    const sp = Math.hypot(s.vx, s.vz);
    if (sp > PEN_SPEED) {
      s.vx *= PEN_SPEED / sp;
      s.vz *= PEN_SPEED / sp;
    }
    s.x += s.vx * DT;
    s.z += s.vz * DT;
    s.grazing = sp < 0.2;
  }

  private collideSheep() {
    const list = this.sheep;
    // Free sheep don't overlap each other.
    for (let a = 0; a < list.length; a++) {
      const s = list[a];
      if (s.state === 'enter') continue;
      for (let b = a + 1; b < list.length; b++) {
        const o = list[b];
        if (o.state === 'enter' || o.pen !== s.pen) continue;
        const dx = o.x - s.x;
        const dz = o.z - s.z;
        const dist = Math.hypot(dx, dz);
        const min = SHEEP_R * 1.9;
        if (dist >= min) continue;
        const nx = dist > 1e-6 ? dx / dist : 1;
        const nz = dist > 1e-6 ? dz / dist : 0;
        const push = (min - dist) * 0.5;
        s.x -= nx * push;
        s.z -= nz * push;
        o.x += nx * push;
        o.z += nz * push;
      }
    }
    for (const s of list) {
      if (s.state === 'enter') continue;
      if (s.state === 'penned') {
        this.keepInPen(s);
        continue;
      }
      // Dogs shoulder sheep aside.
      for (const d of this.dogs) {
        if (!d.alive) continue;
        const dx = s.x - d.x;
        const dz = s.z - d.z;
        const dist = Math.hypot(dx, dz);
        const min = PLAYER_R + SHEEP_R;
        if (dist >= min) continue;
        const nx = dist > 1e-6 ? dx / dist : 1;
        const nz = dist > 1e-6 ? dz / dist : 0;
        s.x = d.x + nx * min;
        s.z = d.z + nz * min;
        const into = s.vx * nx + s.vz * nz;
        if (into < 0) {
          s.vx -= nx * into;
          s.vz -= nz * into;
        }
      }
      for (const pen of this.pens) {
        const { u, v } = penLocal(pen, s.x, s.z);
        if (u < -1 || u > PEN_D + 1 || Math.abs(v) > PEN_W / 2 + 1) continue;
        for (const w of pen.walls) pushOffSeg(s, w, SHEEP_R);
      }
      pushOffRocks(s, SHEEP_R);
      clampEllipse(s, SHEEP_R);
    }
  }

  private keepInPen(s: Sheep) {
    const pen = this.pens[s.pen];
    const { u, v } = penLocal(pen, s.x, s.z);
    const m = SHEEP_R + 0.08;
    const cu = clamp(u, CAPTURE_U, PEN_D - m);
    const cv = clamp(v, -PEN_W / 2 + m, PEN_W / 2 - m);
    if (cu === u && cv === v) return;
    const p = penWorld(pen, cu, cv);
    s.x = p.x;
    s.z = p.z;
  }

  /** Free sheep that have walked through a gate are penned for good. */
  private capture() {
    for (const s of this.sheep) {
      if (s.state !== 'free') continue;
      for (const pen of this.pens) {
        if (pen.closed) continue;
        const { u, v } = penLocal(pen, s.x, s.z);
        if (u < CAPTURE_U || u > PEN_D || Math.abs(v) > PEN_W / 2) continue;
        s.state = 'penned';
        s.pen = pen.owner;
        s.alert = 0;
        s.panic = 0;
        const value = sheepValue(s.black);
        pen.count++;
        pen.points += value;
        if (s.black) pen.black++;
        this.events.push({ t: 'pen', id: s.id, pen: pen.owner, value, black: s.black, x: s.x, z: s.z });
        break;
      }
    }
  }

  private tickSpawn() {
    this.spawnT = Math.max(0, this.spawnT - DT);
    if (!this.respawn || this.spawnT > 0 || this.done) return;
    if (this.freeCount >= this.minFlock || this.sheep.length >= MAX_SHEEP) return;
    this.spawnT = SPAWN_GAP;
    const black = this.rng() < BLACK_CHANCE;
    const s = this.addSheep(HUT.x + (this.rng() - 0.5) * 0.8, HUT.z + 1.6, black);
    s.state = 'enter';
    s.grazing = false;
    this.spawned++;
    this.events.push({ t: 'spawn', id: s.id, black });
  }
}

interface Body {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/** Keep a body of radius r inside the meadow fence. */
function clampEllipse(b: Body, r: number) {
  const rx = RX - r;
  const rz = RZ - r;
  const q = ellipseQ(b.x, b.z, rx, rz);
  if (q <= 1) return;
  b.x /= q;
  b.z /= q;
  let nx = b.x / (rx * rx);
  let nz = b.z / (rz * rz);
  const l = Math.hypot(nx, nz) || 1;
  nx /= l;
  nz /= l;
  const out = b.vx * nx + b.vz * nz;
  if (out > 0) {
    b.vx -= nx * out;
    b.vz -= nz * out;
  }
}

function pushOffRocks(b: Body, r: number) {
  for (const o of ROCKS) {
    const dx = b.x - o.x;
    const dz = b.z - o.z;
    const dist = Math.hypot(dx, dz);
    const min = o.r + r;
    if (dist >= min) continue;
    const nx = dist > 1e-6 ? dx / dist : 1;
    const nz = dist > 1e-6 ? dz / dist : 0;
    b.x = o.x + nx * min;
    b.z = o.z + nz * min;
    const into = b.vx * nx + b.vz * nz;
    if (into < 0) {
      b.vx -= nx * into;
      b.vz -= nz * into;
    }
  }
}

/** Push a body of radius r off a fence segment (from whichever side it's on). */
export function pushOffSeg(b: Body, w: Seg, r: number) {
  const ex = w.bx - w.ax;
  const ez = w.bz - w.az;
  const len2 = ex * ex + ez * ez || 1;
  const t = clamp(((b.x - w.ax) * ex + (b.z - w.az) * ez) / len2, 0, 1);
  const cx = w.ax + ex * t;
  const cz = w.az + ez * t;
  const dx = b.x - cx;
  const dz = b.z - cz;
  const dist = Math.hypot(dx, dz);
  if (dist >= r) return false;
  const nx = dist > 1e-6 ? dx / dist : -ez / Math.sqrt(len2);
  const nz = dist > 1e-6 ? dz / dist : ex / Math.sqrt(len2);
  b.x = cx + nx * r;
  b.z = cz + nz * r;
  const into = b.vx * nx + b.vz * nz;
  if (into < 0) {
    b.vx -= nx * into;
    b.vz -= nz * into;
  }
  return true;
}

/** Final scores: totals for everyone still in (removed players aren't scored). */
export function finalScores(ids: readonly string[], totals: readonly number[], removed: ReadonlySet<number>) {
  const out: Record<string, number> = {};
  ids.forEach((id, i) => {
    if (!removed.has(i)) out[id] = totals[i] ?? 0;
  });
  return out;
}

/** "1st", "2nd"… */
export function placeText(place: number) {
  return ['', '1st', '2nd', '3rd'][place] ?? `${place}th`;
}

export function howTo(short: boolean): string[] {
  return ['Run at the sheep to herd them into your pen', 'Whistle scares them away from you · black sheep 3', short ? 'One round of 75 s · most sheep wins' : 'Two rounds of 75 s · most sheep wins'];
}
