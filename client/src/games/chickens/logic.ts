/**
 * Kurnik ("henhouse"): pure simulation. No DOM, no three.js.
 *
 * A fenced farmyard with a little coop for every player round the edge. Hens wander, peck and flap
 * away from anyone who comes near. Grab one (up to three ride on your head, and each one slows you
 * down), walk into your own coop's doorway and they're home: +1 each, +3 for the golden hen. Shove a
 * rival who is carrying hens and they drop the lot, which scatter flapping. New hens keep coming in
 * through the gate, so the yard never empties.
 *
 * World units are metres, y is up, the yard is centred on the origin. +z is towards the camera; the
 * gate is in the front fence, coops stand along the left, back and right fences.
 */
import type { Rng } from '../rng';

export const DT = 1 / 60;

/** Full game / tournament version. */
export const ROUNDS = 2;
export const ROUNDS_SHORT = 1;
export const ROUND_S = 60;
/** The last this-many seconds: "Ostatnie 10 sekund!" and the hens run faster. */
export const RUSH_S = 10;
export const RUSH_MULT = 1.3;

// ---- the yard -----------------------------------------------------------------------------------
export const YARD_W = 30;
export const YARD_D = 18;
export const HALF_W = YARD_W / 2;
export const HALF_D = YARD_D / 2;
/** The gate in the front fence: hens come in here. */
export const GATE_X = 0;
export const GATE_W = 3;

// ---- players ------------------------------------------------------------------------------------
export const PLAYER_R = 0.7;
export const WALK = 6.2;
export const ACCEL = 42;
/** Each carried hen takes this fraction off your speed. */
export const CARRY_SLOW = 0.12;
export const MAX_CARRY = 3;
export const DEADZONE = 0.14;
/** How far from your centre you can grab a hen. */
export const GRAB_R = 1.75;
/** A press this long before it can work still counts. */
export const BUFFER = 0.15;
/** Shove: a short lunge in the direction you face. */
export const LUNGE_T = 0.22;
export const LUNGE_V = 13;
export const SHOVE_CD = 2.5;
/** Centre distance at which a lunge connects. */
export const HIT_R = PLAYER_R * 2 + 0.25;
export const KNOCK_V = 9;
export const STUN = 0.8;
/** The doorway of your coop: walk within this of its door point to drop your hens in. */
export const DOOR_R = 1.5;
/** In the puddle you slide: this much grip instead of ACCEL, and hardly any friction. */
export const PUDDLE_ACCEL = 7;

// ---- hens ---------------------------------------------------------------------------------------
export const HEN_R = 0.35;
export const WANDER_V = 1.1;
export const FLEE_V = 4.6;
export const HEN_ACCEL = 16;
/** Hens notice a player this close and run. The golden one is jumpier. */
export const FLEE_R = 4.2;
export const GOLD_FLEE_R = 5.2;
export const GOLD_MULT = 1.12;
export const GOLD_CHANCE = 0.1;
/** Points per hen. */
export const HEN_PTS = 1;
export const GOLD_PTS = 3;
/** Gravity for flapping hens (they flutter, so it's gentle). */
export const HEN_G = 14;
/** After being dropped, a hen can't be grabbed for this long (so it actually scatters). */
export const DROP_GRACE = 0.45;
/** A hen arrives through the gate this often while the yard is short of hens. */
export const SPAWN_GAP = 0.55;

/** How many free hens the yard keeps (carried ones don't count). */
export function minHens(n: number) {
  return Math.min(22, 6 + 2 * Math.max(1, n));
}

/** Round obstacles: the well, the hay cart and the dog kennel. */
export const OBSTACLES: readonly { x: number; z: number; r: number; what: 'well' | 'cart' | 'kennel' }[] = [
  { x: -7, z: 1.5, r: 1.3, what: 'well' },
  { x: 5.6, z: -2.6, r: 1.15, what: 'cart' },
  { x: 7.8, z: -2.6, r: 1.15, what: 'cart' },
  { x: 11.6, z: 6.6, r: 1.0, what: 'kennel' },
];
/** The dog by the kennel: hens keep away from it. */
export const DOG = { x: 10.4, z: 6.3, r: 2.3 };
/** The slippery puddle (an ellipse). */
export const PUDDLE = { x: -2.5, z: 4.6, rx: 2.6, rz: 1.5 };

export function inPuddle(x: number, z: number) {
  const dx = (x - PUDDLE.x) / PUDDLE.rx;
  const dz = (z - PUDDLE.z) / PUDDLE.rz;
  return dx * dx + dz * dz < 1;
}

// ---- coops ----------------------------------------------------------------------------------------
export type Edge = 'L' | 'B' | 'R';

export interface Coop {
  edge: Edge;
  /** The coop itself (just outside the fence). */
  x: number;
  z: number;
  /** The door point, just inside the fence: walk in here. */
  dx: number;
  dz: number;
  /** Unit vector from the coop into the yard (the way its door faces). */
  nx: number;
  nz: number;
}

/** Where the coops go for n players: an edge and a position along it (z on the sides, x on the back). */
const COOP_LAYOUT: readonly (readonly [Edge, number][])[] = [
  [['B', 0]],
  [
    ['L', 0],
    ['R', 0],
  ],
  [
    ['L', 0],
    ['B', 0],
    ['R', 0],
  ],
  [
    ['L', 1],
    ['B', -6],
    ['B', 6],
    ['R', 1],
  ],
  [
    ['L', 2],
    ['B', -8],
    ['B', 0],
    ['B', 8],
    ['R', 2],
  ],
  [
    ['L', 3],
    ['L', -4],
    ['B', -5],
    ['B', 5],
    ['R', -4],
    ['R', 3],
  ],
  [
    ['L', 3],
    ['L', -4],
    ['B', -8],
    ['B', 0],
    ['B', 8],
    ['R', -4],
    ['R', 3],
  ],
  [
    ['L', 3],
    ['L', -4],
    ['B', -10],
    ['B', -3.5],
    ['B', 3.5],
    ['B', 10],
    ['R', -4],
    ['R', 3],
  ],
];

/** How far outside the fence a coop stands, and how far inside its door point is. */
const COOP_OUT = 1.4;
const DOOR_IN = 0.7;

export function coopsFor(n: number): Coop[] {
  const layout = COOP_LAYOUT[Math.max(1, Math.min(8, n)) - 1];
  return layout.map(([edge, t]) => {
    if (edge === 'L') return { edge, x: -HALF_W - COOP_OUT, z: t, dx: -HALF_W + DOOR_IN, dz: t, nx: 1, nz: 0 };
    if (edge === 'R') return { edge, x: HALF_W + COOP_OUT, z: t, dx: HALF_W - DOOR_IN, dz: t, nx: -1, nz: 0 };
    return { edge, x: t, z: -HALF_D - COOP_OUT, dx: t, dz: -HALF_D + DOOR_IN, nx: 0, nz: 1 };
  });
}

// ---- state ------------------------------------------------------------------------------------------
export type HenKind = 'white' | 'brown' | 'gold';
/** enter: walking in through the gate; roam: on the ground; air: flapping (hop or scattered); carried. */
export type HenState = 'enter' | 'roam' | 'air' | 'carried';

export interface Hen {
  id: number;
  kind: HenKind;
  state: HenState;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  vy: number;
  /** Facing, radians (0 = +z). */
  dir: number;
  /** Who carries it (-1: nobody) and where in the stack (0 = bottom). */
  carrier: number;
  slot: number;
  /** Wander target and how long it stands pecking. */
  tx: number;
  tz: number;
  peck: number;
  /** Running away right now (for the animation). */
  fleeing: boolean;
  /** Seconds until it can be grabbed again after being dropped. */
  grace: number;
  /** A slowly drifting angle that makes every hen run its own wobbly way. */
  jit: number;
  /** Seconds until it may hop again. */
  hopCd: number;
}

export interface Farmer {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing (unit vector). */
  fx: number;
  fz: number;
  /** How hard the stick is pushed, 0..1 (for the walk animation). */
  speed: number;
  stun: number;
  lunge: number;
  shoveCd: number;
  grabBuf: number;
  shoveBuf: number;
  /** Hen ids on your head, bottom first. */
  carry: number[];
  /** Already knocked by the current lunge. */
  hit: number[];
  gone: boolean;
}

export interface ChickInput {
  /** Joystick, -1..1 each; +x right, +z towards the viewer. */
  x: number;
  z: number;
  /** A press of Grab / Shove since the last step. */
  grab?: boolean;
  shove?: boolean;
}

export type ChickEvent =
  | { t: 'grab'; p: number; hen: number; kind: HenKind }
  | { t: 'miss'; p: number; full: boolean }
  | { t: 'deliver'; p: number; hens: number[]; kinds: HenKind[]; pts: number }
  | { t: 'lunge'; p: number }
  | { t: 'shove'; p: number; by: number; dropped: number[] }
  | { t: 'drop'; p: number; hens: number[] }
  | { t: 'spawn'; hen: number; kind: HenKind }
  | { t: 'hop'; hen: number }
  | { t: 'land'; hen: number }
  | { t: 'rush' }
  | { t: 'over' };

export interface ChickOptions {
  rng?: Rng;
  /** Players who have left (they get no farmer). */
  gone?: boolean[];
  length?: number;
  /** false: no hens to start with and none arrive (for tests). */
  spawn?: boolean;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class ChickSim {
  readonly n: number;
  readonly length: number;
  readonly coops: Coop[];
  readonly players: Farmer[];
  hens: Hen[] = [];
  /** Points this round (hens delivered, the golden one counts 3) and hens delivered. */
  readonly points: number[];
  readonly delivered: number[];
  time = 0;
  rush = false;
  over = false;
  spawning: boolean;
  readonly target: number;
  private nextId = 1;
  private spawnT = 0;
  private events: ChickEvent[] = [];
  private readonly rng: Rng;

  constructor(n: number, opts: ChickOptions = {}) {
    this.n = n;
    this.rng = opts.rng ?? Math.random;
    this.length = opts.length ?? ROUND_S;
    this.spawning = opts.spawn !== false;
    this.coops = coopsFor(n);
    this.points = Array.from({ length: n }, () => 0);
    this.delivered = Array.from({ length: n }, () => 0);
    const gone = opts.gone ?? [];
    // Everybody starts a few steps in front of their own coop, facing the yard.
    this.players = this.coops.map((c, i) => ({
      x: c.dx + c.nx * 2.2,
      z: c.dz + c.nz * 2.2,
      vx: 0,
      vz: 0,
      fx: c.nx,
      fz: c.nz,
      speed: 0,
      stun: 0,
      lunge: 0,
      shoveCd: 0,
      grabBuf: 0,
      shoveBuf: 0,
      carry: [],
      hit: [],
      gone: !!gone[i],
    }));
    const alive = this.players.filter((p) => !p.gone).length;
    this.target = minHens(alive);
    if (this.spawning) {
      let gold = false;
      for (let k = 0; k < this.target; k++) {
        const pos = this.freeSpot();
        const kind = this.pickKind(gold);
        if (kind === 'gold') gold = true;
        this.addHen(kind, pos.x, pos.z);
      }
    }
  }

  get left() {
    return Math.max(0, this.length - this.time);
  }
  get done() {
    return this.over;
  }
  get solo() {
    return this.players.filter((p) => !p.gone).length <= 1;
  }

  hen(id: number) {
    return this.hens.find((h) => h.id === id);
  }

  /** Hens on the ground or in the air (not carried). */
  get freeHens() {
    return this.hens.filter((h) => h.state !== 'carried').length;
  }

  /** Player indices, most points first (ties keep join order). */
  ranking() {
    return this.points
      .map((c, i) => ({ c, i }))
      .filter((x) => !this.players[x.i].gone)
      .sort((a, b) => b.c - a.c || a.i - b.i)
      .map((x) => x.i);
  }

  /** Put a hen in the yard (tests, and the spawner). */
  addHen(kind: HenKind, x: number, z: number, state: HenState = 'roam'): Hen {
    const h: Hen = {
      id: this.nextId++,
      kind,
      state,
      x,
      z,
      y: 0,
      vx: 0,
      vz: 0,
      vy: 0,
      dir: this.rng() * Math.PI * 2,
      carrier: -1,
      slot: 0,
      tx: x,
      tz: z,
      peck: this.rng() * 1.5,
      fleeing: false,
      grace: 0,
      jit: (this.rng() - 0.5) * 2,
      hopCd: 1 + this.rng() * 2,
    };
    this.hens.push(h);
    return h;
  }

  private pickKind(haveGold: boolean): HenKind {
    const goldAround = haveGold || this.hens.some((h) => h.kind === 'gold');
    if (!goldAround && this.rng() < GOLD_CHANCE) return 'gold';
    return this.rng() < 0.55 ? 'white' : 'brown';
  }

  /** A random spot in the yard away from the walls, the props and the players. */
  private freeSpot() {
    for (let k = 0; k < 40; k++) {
      const x = (this.rng() * 2 - 1) * (HALF_W - 3);
      const z = (this.rng() * 2 - 1) * (HALF_D - 2.5);
      if (OBSTACLES.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 1)) continue;
      if (this.players.some((p) => !p.gone && Math.hypot(x - p.x, z - p.z) < 3)) continue;
      return { x, z };
    }
    return { x: (this.rng() - 0.5) * 6, z: (this.rng() - 0.5) * 4 };
  }

  /** A player leaves for good: whatever they carry is let go. */
  remove(i: number) {
    const p = this.players[i];
    if (!p || p.gone) return;
    const freed = this.dropAll(i, 0, 0);
    p.gone = true;
    p.lunge = 0;
    p.vx = p.vz = 0;
    if (freed.length) this.events.push({ t: 'drop', p: i, hens: freed });
  }

  // ---- the step ---------------------------------------------------------------------------------

  /** `live`: the clock runs and the buttons work (false before "go" and after the whistle). */
  step(inputs: (ChickInput | undefined)[], live = true): ChickEvent[] {
    this.events = [];
    const ev = this.events;
    if (live && !this.over) {
      this.time += DT;
      if (!this.rush && this.left <= RUSH_S) {
        this.rush = true;
        ev.push({ t: 'rush' });
      }
    }
    for (let i = 0; i < this.n; i++) this.control(i, live && !this.over ? inputs[i] : { x: inputs[i]?.x ?? 0, z: inputs[i]?.z ?? 0 });
    this.collidePlayers();
    for (let i = 0; i < this.n; i++) {
      this.keepIn(this.players[i]);
      if (live && !this.over) this.checkDoor(i);
    }
    this.moveHens();
    if (this.spawning) this.spawn();
    if (live && !this.over && this.time >= this.length) {
      this.over = true;
      ev.push({ t: 'over' });
    }
    return ev;
  }

  private control(i: number, inp: ChickInput = { x: 0, z: 0 }) {
    const p = this.players[i];
    if (p.gone) return;
    p.shoveCd = Math.max(0, p.shoveCd - DT);
    p.grabBuf = Math.max(0, p.grabBuf - DT);
    p.shoveBuf = Math.max(0, p.shoveBuf - DT);
    if (inp.grab) p.grabBuf = BUFFER;
    if (inp.shove) p.shoveBuf = BUFFER;
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
    const slick = inPuddle(p.x, p.z);
    if (p.stun > 0) {
      p.stun = Math.max(0, p.stun - DT);
      const k = Math.exp(-(slick ? 1.2 : 4) * DT);
      p.vx *= k;
      p.vz *= k;
      p.grabBuf = p.shoveBuf = 0;
    } else if (p.lunge > 0) {
      p.lunge = Math.max(0, p.lunge - DT);
      p.vx = p.fx * LUNGE_V;
      p.vz = p.fz * LUNGE_V;
      this.lungeHits(i);
      if (p.lunge === 0) {
        p.vx *= 0.3;
        p.vz *= 0.3;
      }
    } else {
      const top = WALK * (1 - CARRY_SLOW * p.carry.length);
      const tx = mx * top;
      const tz = mz * top;
      const dvx = tx - p.vx;
      const dvz = tz - p.vz;
      const dl = Math.hypot(dvx, dvz);
      const step = (slick ? PUDDLE_ACCEL : ACCEL) * DT;
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
      if (p.shoveBuf > 0 && p.shoveCd <= 0) this.startLunge(i);
      else if (p.grabBuf > 0) this.tryGrab(i);
    }
    p.x += p.vx * DT;
    p.z += p.vz * DT;
  }

  private startLunge(i: number) {
    const p = this.players[i];
    p.lunge = LUNGE_T;
    p.shoveCd = SHOVE_CD;
    p.shoveBuf = 0;
    p.hit = [];
    p.vx = p.fx * LUNGE_V;
    p.vz = p.fz * LUNGE_V;
    this.events.push({ t: 'lunge', p: i });
    this.lungeHits(i);
  }

  /** The nearest hen within reach that can be picked up, or null. */
  reachable(i: number): Hen | null {
    const p = this.players[i];
    let best: Hen | null = null;
    let bestD = GRAB_R;
    for (const h of this.hens) {
      if (h.state === 'carried' || h.state === 'enter' || h.grace > 0 || h.y > 1.2) continue;
      const d = Math.hypot(h.x - p.x, h.z - p.z);
      if (d <= bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  private tryGrab(i: number) {
    const p = this.players[i];
    if (p.carry.length >= MAX_CARRY) {
      p.grabBuf = 0;
      this.events.push({ t: 'miss', p: i, full: true });
      return;
    }
    const h = this.reachable(i);
    if (!h) {
      // Keep the press buffered a moment: a hen may wander into reach.
      if (p.grabBuf <= DT * 1.01) this.events.push({ t: 'miss', p: i, full: false });
      return;
    }
    p.grabBuf = 0;
    h.state = 'carried';
    h.carrier = i;
    h.slot = p.carry.length;
    h.vx = h.vz = h.vy = 0;
    h.fleeing = false;
    p.carry.push(h.id);
    this.events.push({ t: 'grab', p: i, hen: h.id, kind: h.kind });
  }

  /** A lunging player knocks over everyone it touches; carriers drop their hens. */
  private lungeHits(i: number) {
    const p = this.players[i];
    for (let j = 0; j < this.n; j++) {
      const o = this.players[j];
      if (j === i || o.gone || p.hit.includes(j)) continue;
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      if (Math.hypot(dx, dz) > HIT_R) continue;
      p.hit.push(j);
      o.stun = STUN;
      o.lunge = 0;
      // Knocked back along the lunge, a little away from the shover.
      const d = Math.hypot(dx, dz) || 1;
      let kx = p.fx + (dx / d) * 0.5;
      let kz = p.fz + (dz / d) * 0.5;
      const kl = Math.hypot(kx, kz) || 1;
      kx /= kl;
      kz /= kl;
      o.vx = kx * KNOCK_V;
      o.vz = kz * KNOCK_V;
      const dropped = this.dropAll(j, kx, kz);
      this.events.push({ t: 'shove', p: j, by: i, dropped });
      // The shover's lunge stops dead on impact.
      p.lunge = 0;
      p.vx *= 0.2;
      p.vz *= 0.2;
    }
  }

  /** Everything player i carries scatters, flapping (pushed along kx, kz). Returns the hen ids. */
  private dropAll(i: number, kx: number, kz: number): number[] {
    const p = this.players[i];
    const ids = p.carry.slice();
    p.carry = [];
    ids.forEach((id, k) => {
      const h = this.hen(id);
      if (!h) return;
      const a = this.rng() * Math.PI * 2;
      const sp = 2.6 + this.rng() * 2.4;
      h.state = 'air';
      h.carrier = -1;
      h.slot = 0;
      h.x = p.x;
      h.z = p.z;
      h.y = 1.1 + k * 0.45;
      h.vx = Math.cos(a) * sp + kx * 2.5;
      h.vz = Math.sin(a) * sp + kz * 2.5;
      h.vy = 3.6 + this.rng() * 2;
      h.dir = Math.atan2(h.vx, h.vz);
      h.grace = DROP_GRACE;
      h.peck = 0;
      h.hopCd = 1.5;
    });
    return ids;
  }

  private checkDoor(i: number) {
    const p = this.players[i];
    if (p.gone || !p.carry.length) return;
    const c = this.coops[i];
    if (Math.hypot(p.x - c.dx, p.z - c.dz) > DOOR_R) return;
    const ids = p.carry.slice();
    const kinds: HenKind[] = [];
    let pts = 0;
    for (const id of ids) {
      const h = this.hen(id);
      const kind = h?.kind ?? 'white';
      kinds.push(kind);
      pts += kind === 'gold' ? GOLD_PTS : HEN_PTS;
    }
    p.carry = [];
    this.hens = this.hens.filter((h) => !ids.includes(h.id));
    this.points[i] += pts;
    this.delivered[i] += ids.length;
    this.events.push({ t: 'deliver', p: i, hens: ids, kinds, pts });
  }

  /** Soft circles: overlapping players are pushed apart (a lunging player doesn't give way). */
  private collidePlayers() {
    for (let i = 0; i < this.n; i++) {
      const a = this.players[i];
      if (a.gone) continue;
      for (let j = i + 1; j < this.n; j++) {
        const b = this.players[j];
        if (b.gone) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = PLAYER_R * 2;
        if (d >= min) continue;
        const nx = d > 1e-6 ? dx / d : 1;
        const nz = d > 1e-6 ? dz / d : 0;
        const push = min - d;
        const wa = a.lunge > 0 ? 0 : b.lunge > 0 ? 1 : 0.5;
        a.x -= nx * push * wa;
        a.z -= nz * push * wa;
        b.x += nx * push * (1 - wa);
        b.z += nz * push * (1 - wa);
      }
    }
  }

  /** Inside the fence and out of the props. */
  private keepIn(p: Farmer) {
    if (p.gone) return;
    for (const o of OBSTACLES) {
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + PLAYER_R;
      if (d < min) {
        const nx = d > 1e-6 ? dx / d : 1;
        const nz = d > 1e-6 ? dz / d : 0;
        p.x = o.x + nx * min;
        p.z = o.z + nz * min;
      }
    }
    const mx = HALF_W - PLAYER_R;
    const mz = HALF_D - PLAYER_R;
    if (p.x < -mx || p.x > mx) p.vx = 0;
    if (p.z < -mz || p.z > mz) p.vz = 0;
    p.x = clamp(p.x, -mx, mx);
    p.z = clamp(p.z, -mz, mz);
  }

  // ---- hens ---------------------------------------------------------------------------------------

  private moveHens() {
    const mult = this.rush ? RUSH_MULT : 1;
    for (const h of this.hens) {
      h.grace = Math.max(0, h.grace - DT);
      h.hopCd = Math.max(0, h.hopCd - DT);
      switch (h.state) {
        case 'carried': {
          const p = this.players[h.carrier];
          if (!p) break;
          h.x = p.x;
          h.z = p.z;
          h.y = 1.05 + h.slot * 0.45;
          h.dir = Math.atan2(p.fx, p.fz);
          break;
        }
        case 'enter': {
          // Straight in through the gate, then off into the yard.
          h.fleeing = false;
          const dx = h.tx - h.x;
          const dz = h.tz - h.z;
          const d = Math.hypot(dx, dz);
          const v = 2.4;
          if (d < 0.3 || h.z < HALF_D - 2.2) {
            h.state = 'roam';
            h.peck = 0.3;
            this.pickTarget(h);
          } else {
            h.vx = (dx / d) * v;
            h.vz = (dz / d) * v;
            h.dir = Math.atan2(h.vx, h.vz);
          }
          h.x += h.vx * DT;
          h.z += h.vz * DT;
          break;
        }
        case 'air': {
          h.vy -= HEN_G * DT;
          h.y += h.vy * DT;
          const k = Math.exp(-0.8 * DT);
          h.vx *= k;
          h.vz *= k;
          h.x += h.vx * DT;
          h.z += h.vz * DT;
          this.henWalls(h);
          if (h.y <= 0) {
            h.y = 0;
            h.vy = 0;
            h.state = 'roam';
            h.peck = 0;
            this.pickTarget(h);
            this.events.push({ t: 'land', hen: h.id });
          }
          break;
        }
        case 'roam':
          this.roam(h, mult);
          break;
      }
    }
    this.separateHens();
  }

  private pickTarget(h: Hen) {
    const r = 3 + this.rng() * 5;
    const a = this.rng() * Math.PI * 2;
    h.tx = clamp(h.x + Math.cos(a) * r, -HALF_W + 1.5, HALF_W - 1.5);
    h.tz = clamp(h.z + Math.sin(a) * r, -HALF_D + 1.5, HALF_D - 1.5);
  }

  private roam(h: Hen, mult: number) {
    const gold = h.kind === 'gold';
    const R = gold ? GOLD_FLEE_R : FLEE_R;
    let ax = 0;
    let az = 0;
    let threat = 0;
    for (const p of this.players) {
      if (p.gone) continue;
      const dx = h.x - p.x;
      const dz = h.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d >= R || d < 1e-6) continue;
      const w = 1 - d / R;
      ax += (dx / d) * w;
      az += (dz / d) * w;
      threat = Math.max(threat, w);
    }
    {
      const dx = h.x - DOG.x;
      const dz = h.z - DOG.z;
      const d = Math.hypot(dx, dz);
      if (d < DOG.r && d > 1e-6) {
        const w = (1 - d / DOG.r) * 0.8;
        ax += (dx / d) * w;
        az += (dz / d) * w;
        threat = Math.max(threat, w);
      }
    }
    // Every hen runs its own wobbly way.
    h.jit = clamp(h.jit + (this.rng() - 0.5) * 6 * DT, -1.2, 1.2);
    let tvx = 0;
    let tvz = 0;
    if (threat > 0) {
      h.fleeing = true;
      h.peck = 0;
      // Keep off the fence and the props, so hens run along a wall instead of into it.
      const wall = this.wallPush(h.x, h.z, 2.2);
      ax += wall.x * 1.3;
      az += wall.z * 1.3;
      const len = Math.hypot(ax, az) || 1;
      const ang = Math.atan2(ax / len, az / len) + h.jit * 0.55;
      const sp = FLEE_V * (gold ? GOLD_MULT : 1) * mult * (0.55 + 0.45 * Math.min(1, threat * 2.2));
      tvx = Math.sin(ang) * sp;
      tvz = Math.cos(ang) * sp;
      // Now and then a panicked hen hops and flutters (over another hen, or just because).
      if (h.hopCd <= 0 && this.rng() < (this.crowded(h) ? 3 : 0.35) * DT) this.hop(h, tvx, tvz);
    } else {
      h.fleeing = false;
      if (h.peck > 0) {
        h.peck -= DT;
        if (h.peck <= 0) this.pickTarget(h);
      } else {
        const dx = h.tx - h.x;
        const dz = h.tz - h.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.25) {
          h.peck = 0.8 + this.rng() * 2.2;
        } else {
          const ang = Math.atan2(dx, dz) + h.jit * 0.3;
          tvx = Math.sin(ang) * WANDER_V * mult;
          tvz = Math.cos(ang) * WANDER_V * mult;
        }
      }
    }
    const dvx = tvx - h.vx;
    const dvz = tvz - h.vz;
    const dl = Math.hypot(dvx, dvz);
    const step = HEN_ACCEL * DT;
    if (dl <= step) {
      h.vx = tvx;
      h.vz = tvz;
    } else {
      h.vx += (dvx / dl) * step;
      h.vz += (dvz / dl) * step;
    }
    h.x += h.vx * DT;
    h.z += h.vz * DT;
    if (Math.hypot(h.vx, h.vz) > 0.2) h.dir = Math.atan2(h.vx, h.vz);
    this.henWalls(h);
  }

  private hop(h: Hen, vx: number, vz: number) {
    h.state = 'air';
    h.vy = 3.8 + this.rng() * 1.2;
    h.vx = vx * 1.1;
    h.vz = vz * 1.1;
    h.hopCd = 1.6 + this.rng() * 2;
    this.events.push({ t: 'hop', hen: h.id });
  }

  /** Another hen right in front of this one. */
  private crowded(h: Hen) {
    const sp = Math.hypot(h.vx, h.vz) || 1;
    const fx = h.vx / sp;
    const fz = h.vz / sp;
    return this.hens.some((o) => {
      if (o === h || o.state !== 'roam') return false;
      const dx = o.x - h.x;
      const dz = o.z - h.z;
      const d = Math.hypot(dx, dz);
      return d < HEN_R * 2.6 && dx * fx + dz * fz > 0;
    });
  }

  /** A push away from the fence and the props, strongest right against them. */
  private wallPush(x: number, z: number, range: number) {
    let px = 0;
    let pz = 0;
    const l = x + HALF_W;
    const r = HALF_W - x;
    const b = z + HALF_D;
    const f = HALF_D - z;
    if (l < range) px += 1 - l / range;
    if (r < range) px -= 1 - r / range;
    if (b < range) pz += 1 - b / range;
    if (f < range) pz -= 1 - f / range;
    for (const o of OBSTACLES) {
      const dx = x - o.x;
      const dz = z - o.z;
      const d = Math.hypot(dx, dz);
      const gap = d - o.r;
      if (gap < range * 0.6 && d > 1e-6) {
        const w = 1 - Math.max(0, gap) / (range * 0.6);
        px += (dx / d) * w;
        pz += (dz / d) * w;
      }
    }
    return { x: px, z: pz };
  }

  /** Hens stay in the yard, out of the props and out of the players' feet. */
  private henWalls(h: Hen) {
    for (const o of OBSTACLES) {
      if (h.y > 1.2) continue;
      const dx = h.x - o.x;
      const dz = h.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + HEN_R;
      if (d < min) {
        const nx = d > 1e-6 ? dx / d : 1;
        const nz = d > 1e-6 ? dz / d : 0;
        h.x = o.x + nx * min;
        h.z = o.z + nz * min;
      }
    }
    if (h.y < 0.6) {
      for (const p of this.players) {
        if (p.gone) continue;
        const dx = h.x - p.x;
        const dz = h.z - p.z;
        const d = Math.hypot(dx, dz);
        const min = PLAYER_R + HEN_R;
        if (d < min) {
          const nx = d > 1e-6 ? dx / d : 1;
          const nz = d > 1e-6 ? dz / d : 0;
          h.x = p.x + nx * min;
          h.z = p.z + nz * min;
        }
      }
    }
    const mx = HALF_W - HEN_R;
    const mz = HALF_D - HEN_R;
    if (h.x < -mx || h.x > mx) h.vx *= -0.3;
    if (h.z < -mz || h.z > mz) h.vz *= -0.3;
    h.x = clamp(h.x, -mx, mx);
    h.z = clamp(h.z, -mz, mz);
  }

  private separateHens() {
    const list = this.hens.filter((h) => h.state === 'roam');
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const A = list[a];
        const B = list[b];
        const dx = B.x - A.x;
        const dz = B.z - A.z;
        const d = Math.hypot(dx, dz);
        const min = HEN_R * 2;
        if (d >= min) continue;
        const nx = d > 1e-6 ? dx / d : 1;
        const nz = d > 1e-6 ? dz / d : 0;
        const push = (min - d) / 2;
        A.x -= nx * push;
        A.z -= nz * push;
        B.x += nx * push;
        B.z += nz * push;
      }
    }
  }

  private spawn() {
    if (this.freeHens >= this.target) {
      this.spawnT = 0;
      return;
    }
    this.spawnT -= DT;
    if (this.spawnT > 0) return;
    this.spawnT = SPAWN_GAP;
    const kind = this.pickKind(false);
    const x = GATE_X + (this.rng() - 0.5) * (GATE_W - 1);
    const h = this.addHen(kind, x, HALF_D + 1.6, 'enter');
    h.tx = GATE_X + (this.rng() - 0.5) * 6;
    h.tz = HALF_D - 3;
    h.dir = Math.PI;
    this.events.push({ t: 'spawn', hen: h.id, kind });
  }
}

/** Short text for the phone after a round. */
export function placeText(place: number) {
  return ['', '1st', '2nd', '3rd'][place] ?? `${place}th`;
}

export function howTo(short: boolean): string[] {
  return ['Grab hens – up to 3 ride on your head', 'Bring them to your coop · golden hen = 3', short ? 'Shove carriers to steal · one 60 s round' : 'Shove carriers to steal · 2 rounds of 60 s'];
}
