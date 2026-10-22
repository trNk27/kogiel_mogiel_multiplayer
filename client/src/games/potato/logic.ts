/**
 * Gorący Ziemniak (“hot potato”): pure simulation. No DOM, no three.js. Our take on Mario Party’s
 * Hot Bob-omb.
 *
 * A village square at harvest time. One pierogi carries a steaming hot potato; touch anybody and it
 * hops over to them. Nobody knows when it will burst (a hidden 9–22 s fuse, a little shorter as
 * fewer are left). When it does, whoever holds it is mashed and out, and after a moment a new potato
 * drops on a random survivor. Last one standing wins the round.
 *
 * World units are metres, y is up. The square is centred on the origin, x to the right and +z
 * towards the camera.
 */
import { mulberry32, type Rng } from '../rng';
import { eliminationPoints, eliminationWinners } from '../arena/elimination';

export { mulberry32 };
export type { Rng };

export const DT = 1 / 60;

/** Full game / tournament version. */
export const POTATO_ROUNDS = 3;
export const POTATO_ROUNDS_SHORT = 1;

// ---- moving ------------------------------------------------------------------------------------------
export const PLAYER_R = 0.7;
export const WALK = 6.2;
/** Whoever holds the potato runs this much faster, so a chase can end. */
export const HOLDER_BOOST = 1.12;
export const ACCEL = 45;
export const DEADZONE = 0.14;
/** Dash: a short burst in the direction you face, then a cooldown. */
export const DASH_TIME = 0.24;
export const DASH_SPEED = 15;
export const DASH_CD = 3;
/** A Dash pressed this long before it is ready still counts. */
export const BUFFER = 0.2;
/** A dash bumps whoever it hits this fast. */
export const BUMP_SPEED = 7;

// ---- the potato --------------------------------------------------------------------------------------
/** Extra reach on top of touching (the pierogi are pushed apart, so they never quite overlap). */
export const TOUCH = 0.14;
/** Whoever just got the potato can’t pass it on for this long (no instant ping-pong). */
export const PASS_COOL = 0.5;
/** How long the potato takes to hop across (the scene’s arc; the new holder has it straight away). */
export const FLIGHT = 0.38;
/** The pause between a burst and the next potato. */
export const DROP_TIME = 2;
export const FUSE_MIN = 9;
export const FUSE_MAX = 22;

/** A hidden fuse for a new potato: 9–22 s with six or more left, down to about 70 % of that with two. */
export function fuseFor(alive: number, rng: Rng): number {
  const k = alive >= 6 ? 1 : 0.72 + 0.07 * Math.max(0, alive - 2);
  return (FUSE_MIN + rng() * (FUSE_MAX - FUSE_MIN)) * k;
}

// ---- the square -------------------------------------------------------------------------------------
export type ObstacleKind = 'fire' | 'bale' | 'cart' | 'sacks';

/** Something you bump into: a circle (`r`) or an axis-aligned box (`hw` × `hd` half sizes). */
export interface Obstacle {
  kind: ObstacleKind;
  shape: 'circle' | 'box';
  x: number;
  z: number;
  r: number;
  hw: number;
  hd: number;
}

export interface Arena {
  /** Width (x) and depth (z) inside the fence. */
  w: number;
  h: number;
  obstacles: Obstacle[];
}

const circle = (kind: ObstacleKind, x: number, z: number, r: number): Obstacle => ({ kind, shape: 'circle', x, z, r, hw: r, hd: r });
const rect = (kind: ObstacleKind, x: number, z: number, hw: number, hd: number): Obstacle => ({ kind, shape: 'box', x, z, r: Math.hypot(hw, hd), hw, hd });

/** The village square for `n` players: a bonfire in the middle, hay bales, a cart and a pile of sacks. */
export function arenaFor(n: number): Arena {
  const w = n <= 4 ? 22 : 26;
  const h = n <= 4 ? 13 : 15;
  return {
    w,
    h,
    obstacles: [
      circle('fire', 0, 0, 1.15),
      rect('bale', -0.29 * w, -0.2 * h, 1.05, 0.55),
      rect('bale', 0.29 * w, 0.22 * h, 1.05, 0.55),
      rect('bale', 0.31 * w, -0.25 * h, 0.55, 1.05),
      rect('bale', -0.31 * w, 0.27 * h, 0.55, 1.05),
      rect('cart', -0.06 * w, -h / 2 + 1.0, 1.5, 0.8),
      circle('sacks', 0.12 * w, h / 2 - 1.2, 0.75),
    ],
  };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Push a circle of radius `rad` at (x, z) out of the walls and obstacles. Returns the new spot and the last push normal. */
export function resolve(arena: Arena, x: number, z: number, rad = PLAYER_R): { x: number; z: number; nx: number; nz: number; hit: boolean } {
  let nx = 0;
  let nz = 0;
  let hit = false;
  for (const o of arena.obstacles) {
    if (o.shape === 'circle') {
      const dx = x - o.x;
      const dz = z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + rad;
      if (d >= min - 1e-9) continue;
      const ux = d > 1e-6 ? dx / d : 1;
      const uz = d > 1e-6 ? dz / d : 0;
      x = o.x + ux * min;
      z = o.z + uz * min;
      nx = ux;
      nz = uz;
      hit = true;
    } else {
      const cx = clamp(x, o.x - o.hw, o.x + o.hw);
      const cz = clamp(z, o.z - o.hd, o.z + o.hd);
      const dx = x - cx;
      const dz = z - cz;
      const d = Math.hypot(dx, dz);
      if (d >= rad - 1e-9) continue;
      if (d > 1e-6) {
        x = cx + (dx / d) * rad;
        z = cz + (dz / d) * rad;
        nx = dx / d;
        nz = dz / d;
      } else {
        // The centre is inside the box: out along the shortest way.
        const px = o.hw - Math.abs(x - o.x);
        const pz = o.hd - Math.abs(z - o.z);
        if (px < pz) {
          const s = x >= o.x ? 1 : -1;
          x = o.x + s * (o.hw + rad);
          nx = s;
          nz = 0;
        } else {
          const s = z >= o.z ? 1 : -1;
          z = o.z + s * (o.hd + rad);
          nx = 0;
          nz = s;
        }
      }
      hit = true;
    }
  }
  const mx = arena.w / 2 - rad;
  const mz = arena.h / 2 - rad;
  if (Math.abs(x) > mx) {
    nx = -Math.sign(x);
    nz = 0;
    x = clamp(x, -mx, mx);
    hit = true;
  }
  if (Math.abs(z) > mz) {
    nx = 0;
    nz = -Math.sign(z);
    z = clamp(z, -mz, mz);
    hit = true;
  }
  return { x, z, nx, nz, hit };
}

/** Where player `i` of `n` starts: on a ring round the bonfire, facing it. */
export function spawnFor(arena: Arena, i: number, n: number) {
  const a = (i / Math.max(1, n)) * Math.PI * 2 + Math.PI / 2;
  const r = resolve(arena, Math.cos(a) * arena.w * 0.22, Math.sin(a) * arena.h * 0.26, PLAYER_R + 0.05);
  return { x: r.x, z: r.z };
}

// ---- players ---------------------------------------------------------------------------------------
export interface PotatoInput {
  /** Joystick, -1..1 each; +x right, +z towards the viewer. */
  x: number;
  z: number;
  /** Dash pressed since the last step. */
  dash?: boolean;
}

export interface PotatoPlayer {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing (unit vector). */
  fx: number;
  fz: number;
  /** How hard the stick is pushed (0..1), for the waddle. */
  speed: number;
  /** Seconds of dash left, the dash cooldown and the buffered press. */
  dash: number;
  dashCd: number;
  dashBuf: number;
  /** Who this dash has bumped already. */
  hit: number[];
  alive: boolean;
  gone: boolean;
  /** The burst this player was mashed by (1-based), or null. */
  outAt: number | null;
  /** How long this player held a potato, in total (for the TV). */
  held: number;
  /** Passes made. */
  passes: number;
}

export interface Potato {
  holder: number;
  /** Who threw it last (-1: it dropped from the sky). */
  from: number;
  /** Seconds this potato has been cooking, and when it bursts. */
  t: number;
  fuse: number;
  /** Seconds before the holder may pass it on. */
  cool: number;
  /** Seconds since it last changed hands. */
  flight: number;
  /** Which potato of the round this is (1-based). */
  n: number;
}

export type PotatoPhase = 'idle' | 'play' | 'drop' | 'done';

export type PotatoEvent =
  | { t: 'dash'; i: number }
  | { t: 'bump'; i: number; j: number }
  | { t: 'pass'; from: number; to: number }
  | { t: 'burst'; i: number; n: number; x: number; z: number }
  | { t: 'drop'; i: number; n: number }
  /** The holder left the game: their potato goes with them. */
  | { t: 'lost'; i: number }
  | { t: 'over' };

export class PotatoSim {
  readonly arena: Arena;
  readonly players: PotatoPlayer[];
  phase: PotatoPhase = 'idle';
  phaseT = 0;
  time = 0;
  potato: Potato | null = null;
  /** Potatoes that have burst this round. */
  bursts = 0;
  /** Potatoes handed out this round. */
  dropped = 0;
  over = false;
  readonly solo: boolean;
  private pending: PotatoEvent[] = [];

  constructor(
    count: number,
    private rng: Rng = Math.random,
    gone: boolean[] = [],
  ) {
    this.arena = arenaFor(count);
    this.players = Array.from({ length: count }, (_, i) => {
      const s = spawnFor(this.arena, i, count);
      const len = Math.hypot(s.x, s.z) || 1;
      return {
        x: s.x,
        z: s.z,
        vx: 0,
        vz: 0,
        fx: -s.x / len,
        fz: -s.z / len,
        speed: 0,
        dash: 0,
        dashCd: 0,
        dashBuf: 0,
        hit: [],
        alive: !gone[i],
        gone: !!gone[i],
        outAt: null,
        held: 0,
        passes: 0,
      };
    });
    this.solo = this.aliveCount <= 1;
    // The first potato is there from the start, so everybody knows whom to run from in the countdown.
    if (!this.solo) this.newPotato(null);
  }

  get aliveCount() {
    return this.players.filter((p) => p.alive && !p.gone).length;
  }

  get holder() {
    return this.potato?.holder ?? -1;
  }

  /** How far the potato has cooked, 0..1 (drives the glow and the whistle). */
  get heat() {
    return this.potato ? Math.min(1, this.potato.t / this.potato.fuse) : 0;
  }

  begin() {
    if (this.phase !== 'idle') return;
    this.phaseT = 0;
    this.phase = this.potato ? 'play' : 'drop';
  }

  /** A player leaves for good. If they had the potato, it goes with them and a new one drops. */
  remove(i: number) {
    const p = this.players[i];
    if (!p || p.gone) return;
    p.gone = true;
    p.alive = false;
    p.dash = 0;
    if (this.potato?.holder === i) {
      this.potato = null;
      this.pending.push({ t: 'lost', i });
      if (this.phase === 'play') {
        this.phase = 'drop';
        this.phaseT = 0;
      } else if (this.phase === 'idle') this.newPotato(null);
    }
  }

  step(inputs: readonly (PotatoInput | undefined)[]): PotatoEvent[] {
    const ev: PotatoEvent[] = this.pending;
    this.pending = [];
    this.time += DT;
    if (this.phase === 'idle') return ev;
    this.phaseT += DT;
    for (let i = 0; i < this.players.length; i++) this.control(i, inputs[i], ev);
    this.collide(ev);
    for (const p of this.players) if (p.alive) this.walls(p);
    if (this.phase === 'play') this.cook(ev);
    else if (this.phase === 'drop' && !this.over && this.phaseT >= DROP_TIME) this.newPotato(ev);
    if (!this.over && this.checkOver()) {
      this.over = true;
      this.phase = 'done';
      this.potato = null;
      ev.push({ t: 'over' });
    }
    return ev;
  }

  private checkOver() {
    const alive = this.aliveCount;
    return this.solo ? true : alive <= 1;
  }

  private newPotato(ev: PotatoEvent[] | null) {
    const live = this.players.map((_, i) => i).filter((i) => this.players[i].alive && !this.players[i].gone);
    if (live.length < 2) return;
    const i = live[Math.min(live.length - 1, Math.floor(this.rng() * live.length))];
    this.dropped++;
    this.potato = { holder: i, from: -1, t: 0, fuse: fuseFor(live.length, this.rng), cool: PASS_COOL, flight: 0, n: this.dropped };
    if (this.phase === 'drop') {
      this.phase = 'play';
      this.phaseT = 0;
    }
    ev?.push({ t: 'drop', i, n: this.dropped });
  }

  private cook(ev: PotatoEvent[]) {
    const pot = this.potato;
    if (!pot) return;
    pot.t += DT;
    pot.flight += DT;
    pot.cool = Math.max(0, pot.cool - DT);
    this.players[pot.holder].held += DT;
    if (pot.cool <= 0) {
      const h = this.players[pot.holder];
      let best = -1;
      let bestD = Infinity;
      this.players.forEach((o, j) => {
        if (j === pot.holder || !o.alive || o.gone) return;
        const d = Math.hypot(o.x - h.x, o.z - h.z);
        if (d < PLAYER_R * 2 + TOUCH && d < bestD) {
          best = j;
          bestD = d;
        }
      });
      if (best >= 0) {
        ev.push({ t: 'pass', from: pot.holder, to: best });
        h.passes++;
        pot.from = pot.holder;
        pot.holder = best;
        pot.cool = PASS_COOL;
        pot.flight = 0;
      }
    }
    if (pot.t >= pot.fuse) {
      const i = pot.holder;
      const p = this.players[i];
      this.bursts++;
      p.alive = false;
      p.outAt = this.bursts;
      p.dash = 0;
      p.vx = p.vz = 0;
      this.potato = null;
      this.phase = 'drop';
      this.phaseT = 0;
      ev.push({ t: 'burst', i, n: this.bursts, x: p.x, z: p.z });
    }
  }

  private control(i: number, inp: PotatoInput | undefined, ev: PotatoEvent[]) {
    const p = this.players[i];
    if (!p.alive || p.gone) return;
    p.dashCd = Math.max(0, p.dashCd - DT);
    p.dashBuf = Math.max(0, p.dashBuf - DT);
    let mx = Number(inp?.x) || 0;
    let mz = Number(inp?.z) || 0;
    let mag = Math.hypot(mx, mz);
    if (mag > 1) {
      mx /= mag;
      mz /= mag;
      mag = 1;
    }
    if (mag < DEADZONE) mx = mz = mag = 0;
    p.speed = mag;
    if (mag > 0) {
      p.fx = mx / mag;
      p.fz = mz / mag;
    }
    if (inp?.dash) p.dashBuf = BUFFER;
    if (p.dash > 0) {
      p.dash = Math.max(0, p.dash - DT);
      if (p.dash === 0) {
        p.vx *= 0.35;
        p.vz *= 0.35;
      }
    } else {
      const top = WALK * (this.potato?.holder === i ? HOLDER_BOOST : 1);
      const tx = mx * top;
      const tz = mz * top;
      const dvx = tx - p.vx;
      const dvz = tz - p.vz;
      const dl = Math.hypot(dvx, dvz);
      const stepV = ACCEL * DT;
      if (dl <= stepV) {
        p.vx = tx;
        p.vz = tz;
      } else {
        p.vx += (dvx / dl) * stepV;
        p.vz += (dvz / dl) * stepV;
      }
      if (p.dashBuf > 0 && p.dashCd <= 0) {
        p.dash = DASH_TIME;
        p.dashCd = DASH_CD;
        p.dashBuf = 0;
        p.hit = [];
        p.vx = p.fx * DASH_SPEED;
        p.vz = p.fz * DASH_SPEED;
        ev.push({ t: 'dash', i });
      }
    }
    p.x += p.vx * DT;
    p.z += p.vz * DT;
  }

  /** Pierogi push each other apart softly; a dash shoves whoever it hits. */
  private collide(ev: PotatoEvent[]) {
    const n = this.players.length;
    for (let i = 0; i < n; i++) {
      const a = this.players[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.players[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = PLAYER_R * 2;
        if (d >= min) continue;
        const nx = d > 1e-6 ? dx / d : 1;
        const nz = d > 1e-6 ? dz / d : 0;
        const push = min - d;
        const wa = a.dash > 0 && b.dash <= 0 ? 0.15 : b.dash > 0 && a.dash <= 0 ? 0.85 : 0.5;
        a.x -= nx * push * wa;
        a.z -= nz * push * wa;
        b.x += nx * push * (1 - wa);
        b.z += nz * push * (1 - wa);
        if (a.dash > 0 && !a.hit.includes(j)) {
          a.hit.push(j);
          b.vx += nx * BUMP_SPEED;
          b.vz += nz * BUMP_SPEED;
          ev.push({ t: 'bump', i, j });
        }
        if (b.dash > 0 && !b.hit.includes(i)) {
          b.hit.push(i);
          a.vx -= nx * BUMP_SPEED;
          a.vz -= nz * BUMP_SPEED;
          ev.push({ t: 'bump', i: j, j: i });
        }
      }
    }
  }

  private walls(p: PotatoPlayer) {
    const r = resolve(this.arena, p.x, p.z);
    if (!r.hit) return;
    p.x = r.x;
    p.z = r.z;
    // Slide along whatever we hit: drop the part of the velocity going into it.
    const into = p.vx * r.nx + p.vz * r.nz;
    if (into < 0) {
      p.vx -= into * r.nx;
      p.vz -= into * r.nz;
    }
  }

  results() {
    const outAt = this.players.map((p) => p.outAt);
    const gone = this.players.map((p) => p.gone);
    return {
      points: eliminationPoints(outAt, gone, this.solo, this.bursts),
      winners: eliminationWinners(outAt, gone, this.solo),
      bursts: this.bursts,
    };
  }
}

export function howTo(short: boolean): string[] {
  return ['Touch someone to pass the hot potato', 'Nobody knows when it bursts – Dash away!', short ? 'One round · last one standing wins' : 'Three rounds · last one standing wins'];
}
