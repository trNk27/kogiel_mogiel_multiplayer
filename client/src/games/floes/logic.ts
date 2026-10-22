/**
 * Kra: pure simulation. No DOM, no three.js. Our take on Fall Guys’ Hex-A-Gone, on a frozen river.
 *
 * Three layers of hexagonal ice floes hang one above the other over dark water (kra is Polish for
 * drifting ice floes). A floe you stand on cracks and drops CRACK_S seconds after you first touch it,
 * so you have to keep moving; fall through a hole and you land on the layer below, fall off the
 * bottom one and you are in the river. Last pierogi dry wins (solo: survive as long as you can).
 *
 * World units are metres, y is up. The layers are centred on the x/z origin, the top one highest.
 * The camera looks from +z, so the joystick's +y (down the phone) walks towards it.
 * Hexes are "pointy" along z: corners at ±z, flat sides at ±x.
 */
import { eliminationPoints, eliminationWinners } from '../arena/elimination';
import type { Rng } from '../rng';

export const DT = 1 / 60;

/** Full game / tournament version. */
export const FLOES_ROUNDS = 3;
export const FLOES_ROUNDS_SHORT = 1;
/** The round ends after this long, whoever is still dry (they share the win). */
export const ROUND_S = 90;

// ---- the ice ----------------------------------------------------------------------------------
/** Centre-to-corner size of a floe. Neighbours sit HEX_W apart. */
export const HEX = 1.25;
export const HEX_W = HEX * Math.sqrt(3);
export const LAYERS = 3;
/** Height of each layer's surface, top first; the water below them all. */
export const LAYER_Y = [14, 7, 0];
export const WATER_Y = -2.6;
/** A floe drops this long after somebody first stands on it. */
export const CRACK_S = 0.55;

/** How many rings of floes round the middle one, for this many players. */
export const ringsFor = (n: number) => (n <= 3 ? 5 : 6);

// ---- players ----------------------------------------------------------------------------------
export const PLAYER_R = 0.55;
export const MAX_SPEED = 6;
/** How fast you get up to speed (and stop) on the ice, and in the air. */
export const ACCEL = 34;
export const AIR_ACCEL = 14;
export const GRAVITY = 24;
export const JUMP_V = 7.2;
export const AIR_TIME = (2 * JUMP_V) / GRAVITY;
/** A press this long before landing still jumps as soon as you touch down. */
export const JUMP_BUFFER = 0.12;
/** You can still jump this long after walking off an edge. */
export const COYOTE = 0.09;
/** The river carries pierogi that fell in downstream (−z, away from the camera, under the footbridge), m/s. */
export const RIVER_FLOW = 1.1;

export interface Floe {
  q: number;
  r: number;
  x: number;
  z: number;
  /** 0 solid, 1 cracking, 2 dropped. */
  state: 0 | 1 | 2;
  /** Sim time it was first stood on / dropped (Infinity: not yet). */
  crackAt: number;
  dropAt: number;
}

export interface Layer {
  y: number;
  floes: Floe[];
}

export interface Skater {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Stick, -1..1 each. */
  sx: number;
  sz: number;
  /** The way the pierogi faces, atan2(dx, dz). */
  face: number;
  /** Standing on a layer (its index), or -1 in the air / in the water. */
  ground: number;
  /** The layer you were on last (or are above): 0 top … LAYERS-1 bottom. */
  layer: number;
  /** Sim time you last stood on ice, and whether you walked off it (for coyote time). */
  groundAt: number;
  walkedOff: boolean;
  /** Sim time of a jump press that hasn't become a jump yet (-1: none). */
  buffered: number;
  alive: boolean;
  gone: boolean;
  /** The sim tick you fell in the water (null while dry). */
  outTick: number | null;
  jumps: number;
}

export type FloesEvent =
  | { t: 'crack'; l: number; f: number; by: number }
  | { t: 'drop'; l: number; f: number }
  | { t: 'jump'; i: number }
  | { t: 'land'; i: number; l: number; hard: boolean }
  | { t: 'fall'; i: number; l: number }
  | { t: 'splash'; i: number; x: number; z: number }
  | { t: 'over' };

const TAU = Math.PI * 2;
const angleDiff = (a: number, b: number) => ((((b - a) % TAU) + 3 * Math.PI) % TAU) - Math.PI;

/** Where hex (q, r) sits (axial coordinates). */
export function hexCenter(q: number, r: number) {
  return { x: HEX_W * (q + r / 2), z: HEX * 1.5 * r };
}

/** Which hex (q, r) contains the point (x, z). */
export function hexRound(x: number, z: number) {
  const fr = z / (HEX * 1.5);
  const fq = x / HEX_W - fr / 2;
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: q + 0, r: r + 0 };
}

export const hexDist = (q: number, r: number) => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;

/** All hexes within `rings` of the middle, middle first, ring by ring. */
export function hexField(rings: number): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  for (let d = 0; d <= rings; d++)
    for (let q = -rings; q <= rings; q++)
      for (let r = -rings; r <= rings; r++) if (hexDist(q, r) === d) out.push({ q, r });
  return out;
}

export type FloesPhase = 'idle' | 'play' | 'done';

export class FloesSim {
  readonly rings: number;
  readonly layers: Layer[];
  readonly players: Skater[];
  readonly solo: boolean;
  phase: FloesPhase = 'idle';
  /** Seconds since "go". */
  time = 0;
  tick = 0;
  over = false;
  /** Ended by the clock (everybody still dry shares the win). */
  timeout = false;
  /** (q, r) → floe index, the same on every layer. */
  private index = new Map<string, number>();

  constructor(
    count: number,
    rng: Rng = Math.random,
    gone: boolean[] = [],
    rings?: number,
  ) {
    const live = Array.from({ length: count }, (_, i) => !gone[i]).filter(Boolean).length;
    this.rings = rings ?? ringsFor(live);
    const field = hexField(this.rings);
    field.forEach((h, k) => this.index.set(`${h.q},${h.r}`, k));
    this.layers = LAYER_Y.map((y) => ({
      y,
      floes: field.map((h) => ({ ...h, ...hexCenter(h.q, h.r), state: 0 as const, crackAt: Infinity, dropAt: Infinity })),
    }));
    // Spread round the top layer, on the floes nearest an even circle.
    const radius = HEX_W * Math.max(1.5, this.rings * (live <= 2 ? 0.45 : 0.62));
    const a0 = rng() * TAU;
    let k = 0;
    this.players = Array.from({ length: count }, (_, i) => {
      const a = a0 + ((gone[i] ? 0 : k++) * TAU) / Math.max(1, live);
      const h = hexRound(Math.cos(a) * radius, Math.sin(a) * radius);
      const c = hexCenter(h.q, h.r);
      return {
        x: live <= 1 ? 0 : c.x,
        y: LAYER_Y[0],
        z: live <= 1 ? 0 : c.z,
        vx: 0,
        vy: 0,
        vz: 0,
        sx: 0,
        sz: 0,
        face: live <= 1 ? 0 : Math.atan2(-c.x, -c.z),
        ground: 0,
        layer: 0,
        groundAt: 0,
        walkedOff: false,
        buffered: -1,
        alive: !gone[i],
        gone: !!gone[i],
        outTick: null,
        jumps: 0,
      };
    });
    this.solo = live <= 1;
  }

  /** "Go!": the ice starts cracking and the pierogi can move. */
  begin() {
    if (this.phase === 'idle') this.phase = 'play';
  }

  get aliveCount() {
    return this.players.filter((p) => p.alive && !p.gone).length;
  }

  /** Seconds left on the clock. */
  get timeLeft() {
    return Math.max(0, ROUND_S - this.time);
  }

  /** The floe under (x, z) on layer `l`, or -1 (off the field). Dropped floes still count here. */
  floeAt(_l: number, x: number, z: number): number {
    const h = hexRound(x, z);
    return this.index.get(`${h.q},${h.r}`) ?? -1;
  }

  /** Is there ice to stand on at (x, z) on layer `l`? (Cracking floes still hold you.) */
  solid(l: number, x: number, z: number) {
    const f = this.floeAt(l, x, z);
    return f >= 0 && this.layers[l].floes[f].state < 2;
  }

  /** Floes left on a layer (not dropped). */
  floesLeft(l: number) {
    return this.layers[l].floes.filter((f) => f.state < 2).length;
  }

  setStick(i: number, x: number, z: number) {
    const p = this.players[i];
    if (!p) return;
    const len = Math.hypot(x, z);
    const k = len > 1 ? 1 / len : 1;
    p.sx = x * k;
    p.sz = z * k;
  }

  /** Ask for a jump (it happens on the next step, or when you next land, if that's soon). */
  press(i: number) {
    const p = this.players[i];
    if (!p || !p.alive || this.phase !== 'play' || this.over) return;
    p.buffered = this.time;
  }

  remove(i: number) {
    const p = this.players[i];
    if (!p) return;
    p.gone = true;
    p.alive = false;
    p.vx = p.vz = p.vy = 0;
  }

  step(): FloesEvent[] {
    const ev: FloesEvent[] = [];
    if (this.phase === 'idle') return ev;
    const live = !this.over;
    if (live) {
      this.time += DT;
      this.tick++;
      this.dropFloes(ev);
    }
    this.move(ev);
    this.push();
    if (live) this.touch(ev);
    if (!this.over && this.checkOver()) {
      this.over = true;
      this.phase = 'done';
      ev.push({ t: 'over' });
    }
    return ev;
  }

  private checkOver() {
    if (this.time >= ROUND_S - 1e-9) {
      this.timeout = true;
      return true;
    }
    const alive = this.aliveCount;
    return this.solo ? alive === 0 : alive <= 1;
  }

  private dropFloes(ev: FloesEvent[]) {
    this.layers.forEach((layer, l) =>
      layer.floes.forEach((f, k) => {
        if (f.state === 1 && this.time >= f.dropAt - 1e-9) {
          f.state = 2;
          ev.push({ t: 'drop', l, f: k });
        }
      }),
    );
  }

  /** Everybody standing on solid ice cracks the floe under them. */
  private touch(ev: FloesEvent[]) {
    this.players.forEach((p, i) => {
      if (!p.alive || p.ground < 0) return;
      const f = this.floeAt(p.ground, p.x, p.z);
      const floe = f >= 0 ? this.layers[p.ground].floes[f] : null;
      if (floe && floe.state === 0) {
        floe.state = 1;
        floe.crackAt = this.time;
        floe.dropAt = this.time + CRACK_S;
        ev.push({ t: 'crack', l: p.ground, f, by: i });
      }
    });
  }

  private move(ev: FloesEvent[]) {
    const playing = this.phase === 'play' && !this.over;
    this.players.forEach((p, i) => {
      if (p.gone) return;
      if (!p.alive) {
        // In the river: carried downstream, slowing to the current.
        p.vz += (-RIVER_FLOW - p.vz) * Math.min(1, 2 * DT);
        p.vx *= Math.exp(-2 * DT);
        p.x += p.vx * DT;
        p.z += p.vz * DT;
        return;
      }
      // Steering: ice is grippy enough here (the floes are what's slippery).
      const tx = playing ? p.sx * MAX_SPEED : 0;
      const tz = playing ? p.sz * MAX_SPEED : 0;
      const a = (p.ground >= 0 ? ACCEL : AIR_ACCEL) * DT;
      const dx = tx - p.vx;
      const dz = tz - p.vz;
      const d = Math.hypot(dx, dz);
      if (d <= a) {
        p.vx = tx;
        p.vz = tz;
      } else {
        p.vx += (dx / d) * a;
        p.vz += (dz / d) * a;
      }
      p.x += p.vx * DT;
      p.z += p.vz * DT;
      if (playing && Math.hypot(p.sx, p.sz) > 0.2) p.face += angleDiff(p.face, Math.atan2(p.sx, p.sz)) * Math.min(1, 14 * DT);

      // Standing: is the ice still there?
      if (p.ground >= 0) {
        if (this.solid(p.ground, p.x, p.z)) {
          p.groundAt = this.time;
        } else {
          p.layer = p.ground;
          p.ground = -1;
          p.vy = 0;
          p.walkedOff = true;
          ev.push({ t: 'fall', i, l: p.layer });
        }
      }
      // Jumping: from the ice, or just after leaving it.
      if (p.buffered >= 0 && playing) {
        const canJump = p.ground >= 0 || (p.walkedOff && this.time - p.groundAt <= COYOTE + 1e-9);
        if (canJump) {
          if (p.ground >= 0) p.layer = p.ground;
          p.ground = -1;
          p.walkedOff = false;
          p.vy = JUMP_V;
          p.buffered = -1;
          p.jumps++;
          ev.push({ t: 'jump', i });
        } else if (this.time - p.buffered > JUMP_BUFFER + 1e-9) p.buffered = -1;
      }
      if (p.ground >= 0) return;

      // In the air.
      const y0 = p.y;
      p.vy -= GRAVITY * DT;
      p.y += p.vy * DT;
      if (p.vy <= 0) {
        for (let l = 0; l < LAYERS; l++) {
          const ly = LAYER_Y[l];
          if (y0 >= ly - 1e-9 && p.y <= ly && this.solid(l, p.x, p.z)) {
            const hard = p.vy < -JUMP_V * 1.2;
            p.y = ly;
            p.vy = 0;
            p.ground = l;
            p.layer = l;
            p.walkedOff = false;
            p.groundAt = this.time;
            ev.push({ t: 'land', i, l, hard });
            // A buffered jump goes off straight away.
            if (p.buffered >= 0 && this.time - p.buffered <= JUMP_BUFFER + 1e-9 && playing) {
              p.ground = -1;
              p.vy = JUMP_V;
              p.buffered = -1;
              p.jumps++;
              ev.push({ t: 'jump', i });
            }
            break;
          }
          if (p.y < ly) p.layer = Math.min(LAYERS - 1, l + 1);
        }
      }
      if (p.ground < 0 && p.y <= WATER_Y) {
        p.y = WATER_Y;
        p.vy = 0;
        p.layer = LAYERS - 1;
        if (!this.over) {
          p.alive = false;
          p.outTick = this.tick;
          p.vx *= 0.3;
          p.vz *= 0.3;
          ev.push({ t: 'splash', i, x: p.x, z: p.z });
        } else {
          // After the round is decided: just a dip, not an elimination.
          p.vx = p.vz = 0;
          p.ground = -1;
        }
      }
    });
  }

  /** Pierogi on the same layer don't overlap: they nudge each other apart. */
  private push() {
    const ps = this.players;
    for (let a = 0; a < ps.length; a++)
      for (let b = a + 1; b < ps.length; b++) {
        const p = ps[a];
        const q = ps[b];
        if (!p.alive || !q.alive || Math.abs(p.y - q.y) > 0.9) continue;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const d = Math.hypot(dx, dz);
        const min = PLAYER_R * 2;
        if (d >= min) continue;
        const nx = d > 1e-6 ? dx / d : 1;
        const nz = d > 1e-6 ? dz / d : 0;
        const k = (min - d) / 2;
        p.x -= nx * k;
        p.z -= nz * k;
        q.x += nx * k;
        q.z += nz * k;
      }
  }

  /** Seconds a player stayed dry (the whole round if they still are). */
  survived(i: number) {
    const p = this.players[i];
    if (!p) return 0;
    return p.outTick === null ? this.time : p.outTick * DT;
  }

  results() {
    const gone = this.players.map((p) => p.gone);
    if (this.solo) {
      // On your own you score the whole seconds you stayed dry.
      const outAt = this.players.map((p) => (p.outTick === null ? null : Math.floor(p.outTick * DT + 1e-9) + 1));
      return { points: eliminationPoints(outAt, gone, true, Math.floor(this.time + 1e-9)), winners: [] as number[] };
    }
    const outAt = this.players.map((p) => p.outTick);
    return { points: eliminationPoints(outAt, gone, false, 0), winners: eliminationWinners(outAt, gone, false) };
  }
}

export function howTo(short: boolean): string[] {
  return ['The ice cracks where you stand: keep moving', 'JUMP over holes · three layers, then the river', short ? 'One round · last one dry wins' : 'Three rounds · last one dry wins'];
}
