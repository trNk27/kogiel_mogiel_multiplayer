/**
 * Pushy Pierogi: pure simulation. Sumo on a frozen pond. No DOM, no three.js.
 *
 * World units are metres, y is up, the floe is centred on the origin. The joystick pushes (it is an
 * acceleration, not a velocity), so everybody glides and drifts. The floe is a stack of concentric
 * chunks that crack and sink from the outside in; a pierogi whose centre is no longer over a chunk
 * slips into the pond and is out for the round.
 */
import type { Rng } from '../rng';

export const DT = 1 / 60;

/** Full game / tournament version. */
export const PUSHY_ROUNDS = 3;
export const PUSHY_ROUNDS_SHORT = 1;

// ---- floe -------------------------------------------------------------------------------------
export const FLOE_R = 10;
/** Outer radius of each ring of chunks, and how many sectors it is cut into. The centre never breaks. */
export const RING_EDGES = [2.8, 5.2, 7.6, FLOE_R];
export const RING_SECTORS = [1, 8, 12, 16];
/** Cracks start to show this long after "go"; the last chunk starts to crack SHRINK_SPAN s later. */
export const SHRINK_START = 15;
export const SHRINK_SPAN = 55;
/** A cracked chunk sinks this long after its cracks appear. */
export const CRACK_S = 2;
export const ROUND_S = 90;

// ---- players ----------------------------------------------------------------------------------
export const PLAYER_R = 0.8;
export const MAX_SPEED = 7;
export const ACCEL = 12;
/** Ice friction: a pull proportional to speed plus a small constant one. */
export const ICE_DRAG = 0.9;
export const ICE_SCRAPE = 0.8;
export const BRACE_DRAG = 6;
export const BRACE_SCRAPE = 3;
export const MASS = 1;
export const BRACE_MASS = 8;
export const DASH_MASS = 1.5;
export const RESTITUTION = 0.8;
/** Shove: speed added in the chosen direction (the total is capped), how long it counts as a dash. */
export const SHOVE_IMPULSE = 9.5;
export const DASH_CAP = 12;
export const DASH_S = 0.4;
export const SHOVE_COOL_MS = 1600;
export const BRACE_S = 0.8;
export const BRACE_COOL_MS = 3000;
/** Impact speed (m/s along the contact) above which a bump gets a puff, a sound and a buzz. */
export const BIG_BUMP = 4.5;

// ---- curling stones ---------------------------------------------------------------------------
export const STONE_R = 1;
export const STONE_SPEED = 9.5;
export const STONE_MASS = 6;
export const STONE_RESTITUTION = 0.4;
export const STONE_WARN_S = 1.2;
export const STONE_FIRST_S = 10;
export const STONE_START = 20;
/** The playground before "go": nobody may stray further than this from the middle. */
const READY_LIMIT = 7.6;

const TAU = Math.PI * 2;

export interface Chunk {
  id: number;
  ring: number;
  sector: number;
  r0: number;
  r1: number;
  a0: number;
  a1: number;
  /** 0 solid, 1 cracking, 2 gone. */
  state: 0 | 1 | 2;
  crackAt: number;
  breakAt: number;
}

export interface Fighter {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Direction faced, as atan2(dx, dz) – the way a pierogi with rotation.y = face looks. */
  face: number;
  sx: number;
  sz: number;
  alive: boolean;
  removed: boolean;
  /** Sim tick when this one fell in (null while on the ice). */
  fellTick: number | null;
  fellAt: number;
  fallT: number;
  splashed: boolean;
  cause: 'edge' | 'sink' | 'stone' | null;
  braceUntil: number;
  dashUntil: number;
  shoveReady: number;
  braceReady: number;
}

export interface Stone {
  id: number;
  x: number;
  z: number;
  /** Unit direction of travel. */
  dx: number;
  dz: number;
  /** Where it starts, where the warning arrow sits. */
  sx: number;
  sz: number;
  launchAt: number;
  running: boolean;
  done: boolean;
  spin: number;
}

export type PushyEvent =
  | { k: 'bump'; a: number; b: number; x: number; z: number; power: number; dash: boolean; brace: boolean }
  | { k: 'stoneHit'; i: number; x: number; z: number; power: number }
  | { k: 'shove'; i: number }
  | { k: 'brace'; i: number; speed: number }
  | { k: 'crack'; c: number }
  | { k: 'break'; c: number }
  | { k: 'fall'; i: number; x: number; z: number; cause: 'edge' | 'sink' | 'stone' }
  | { k: 'splash'; i: number; x: number; z: number }
  | { k: 'warn'; s: number }
  | { k: 'launch'; s: number }
  | { k: 'end' };

const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
const angleDiff = (a: number, b: number) => ((((b - a) % TAU) + 3 * Math.PI) % TAU) - Math.PI;

/** Build the chunk layout. Ring angles are rotated a little so the seams do not all line up. */
export function buildChunks(rng: Rng): Chunk[] {
  const chunks: Chunk[] = [];
  for (let ring = 0; ring < RING_EDGES.length; ring++) {
    const n = RING_SECTORS[ring];
    const off = ring === 0 ? 0 : rng() * TAU;
    for (let s = 0; s < n; s++) {
      const a0 = off + (s * TAU) / n;
      chunks.push({
        id: chunks.length,
        ring,
        sector: s,
        r0: ring === 0 ? 0 : RING_EDGES[ring - 1],
        r1: RING_EDGES[ring],
        a0,
        a1: a0 + TAU / n,
        state: 0,
        crackAt: Infinity,
        breakAt: Infinity,
      });
    }
  }
  return chunks;
}

/** Which chunk lies under (x, z)? −1 when it is outside the floe. */
export function chunkAt(chunks: readonly Chunk[], x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r >= FLOE_R) return -1;
  let ring = 0;
  while (r >= RING_EDGES[ring]) ring++;
  if (ring === 0) return 0;
  const first = chunks.findIndex((c) => c.ring === ring);
  const n = RING_SECTORS[ring];
  const off = chunks[first].a0;
  const s = Math.floor(wrap(Math.atan2(z, x) - off) / (TAU / n)) % n;
  return first + s;
}

/**
 * When each chunk cracks: outer ring first, then the next one in, each in random sector order, at an
 * even pace from SHRINK_START over SHRINK_SPAN seconds. The centre chunk is never scheduled.
 */
export function chunkSchedule(chunks: readonly Chunk[], rng: Rng, start = SHRINK_START, span = SHRINK_SPAN): { c: number; crackAt: number; breakAt: number }[] {
  const order: number[] = [];
  for (let ring = RING_EDGES.length - 1; ring >= 1; ring--) {
    const ids = chunks.filter((c) => c.ring === ring).map((c) => c.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    order.push(...ids);
  }
  return order.map((c, i) => {
    const crackAt = start + (span * i) / Math.max(1, order.length - 1);
    return { c, crackAt, breakAt: crackAt + CRACK_S };
  });
}

/**
 * Round points: one for every other player who fell in before you (falling in together is a tie);
 * the winner(s) get 2 on top. `winners` are indices.
 */
export function roundPoints(fell: (number | null)[], removed: boolean[], winners: number[]): number[] {
  return fell.map((mine, i) => {
    if (removed[i]) return 0;
    let n = 0;
    fell.forEach((f, j) => {
      if (j !== i && !removed[j] && f !== null && (mine === null || f < mine)) n++;
    });
    return n + (winners.includes(i) ? 2 : 0);
  });
}

export class PushySim {
  readonly chunks: Chunk[];
  readonly players: Fighter[];
  readonly stones: Stone[] = [];
  schedule: { c: number; crackAt: number; breakAt: number }[];
  /** Seconds since "go" (stands still until `start()`). */
  t = 0;
  tick = 0;
  live = false;
  over = false;
  timeout = false;
  winners: number[] = [];
  private nextStone = STONE_FIRST_S;
  private stoneSeq = 0;
  private warned = 0;

  constructor(
    n: number,
    private rng: Rng,
    removed: boolean[] = [],
  ) {
    this.chunks = buildChunks(rng);
    this.lastStoneHit = Array.from({ length: n }, () => -99);
    this.schedule = chunkSchedule(this.chunks, rng);
    for (const s of this.schedule) {
      this.chunks[s.c].crackAt = s.crackAt;
      this.chunks[s.c].breakAt = s.breakAt;
    }
    const radius = n <= 2 ? 4.2 : 5.6;
    const a0 = rng() * TAU;
    this.players = Array.from({ length: n }, (_, i) => {
      const a = a0 + (i * TAU) / n;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      return {
        x,
        z,
        vx: 0,
        vz: 0,
        face: Math.atan2(-x, -z),
        sx: 0,
        sz: 0,
        alive: !removed[i],
        removed: !!removed[i],
        fellTick: null,
        fellAt: -1,
        fallT: 0,
        splashed: false,
        cause: null,
        braceUntil: -1,
        dashUntil: -1,
        shoveReady: 0,
        braceReady: 0,
      };
    });
  }

  /** "Go!" – the clocks start and the buttons work. */
  start() {
    this.live = true;
  }

  setStick(i: number, x: number, y: number) {
    const p = this.players[i];
    if (!p) return;
    const len = Math.hypot(x, y);
    const k = len > 1 ? 1 / len : 1;
    p.sx = x * k;
    p.sz = y * k;
  }

  isBraced(i: number) {
    const p = this.players[i];
    return !!p && this.live && p.alive && this.t < p.braceUntil;
  }
  isDashing(i: number) {
    const p = this.players[i];
    return !!p && this.live && p.alive && this.t < p.dashUntil;
  }
  mass(i: number) {
    return this.isBraced(i) ? BRACE_MASS : this.isDashing(i) ? DASH_MASS : MASS;
  }

  alive() {
    return this.players.filter((p) => p.alive).length;
  }
  timeLeft() {
    return Math.max(0, ROUND_S - this.t);
  }

  /** Dash forward (the stick direction, or the way the pierogi faces). False if it can't right now. */
  shove(i: number, ev?: PushyEvent[]): boolean {
    const p = this.players[i];
    if (!p || !this.live || this.over || !p.alive || this.t < p.shoveReady || this.t < p.braceUntil) return false;
    let dx = Math.sin(p.face);
    let dz = Math.cos(p.face);
    if (Math.hypot(p.sx, p.sz) > 0.25) {
      const l = Math.hypot(p.sx, p.sz);
      dx = p.sx / l;
      dz = p.sz / l;
      p.face = Math.atan2(dx, dz);
    }
    p.vx += dx * SHOVE_IMPULSE;
    p.vz += dz * SHOVE_IMPULSE;
    const sp = Math.hypot(p.vx, p.vz);
    if (sp > DASH_CAP) {
      p.vx *= DASH_CAP / sp;
      p.vz *= DASH_CAP / sp;
    }
    p.dashUntil = this.t + DASH_S;
    p.shoveReady = this.t + SHOVE_COOL_MS / 1000;
    ev?.push({ k: 'shove', i });
    return true;
  }

  /** Plant your feet. */
  brace(i: number, ev?: PushyEvent[]): boolean {
    const p = this.players[i];
    if (!p || !this.live || this.over || !p.alive || this.t < p.braceReady) return false;
    ev?.push({ k: 'brace', i, speed: Math.hypot(p.vx, p.vz) });
    p.braceUntil = this.t + BRACE_S;
    p.braceReady = this.t + BRACE_COOL_MS / 1000;
    p.dashUntil = -1;
    return true;
  }

  onFloe(x: number, z: number) {
    const id = chunkAt(this.chunks, x, z);
    return id >= 0 && this.chunks[id].state !== 2;
  }

  /** The player is dropped (kicked): not part of this round any more. */
  remove(i: number) {
    const p = this.players[i];
    if (!p) return;
    p.removed = true;
    p.alive = false;
    p.vx = p.vz = 0;
    this.checkEnd([]);
  }

  step(): PushyEvent[] {
    const ev: PushyEvent[] = [];
    if (this.live && !this.over) {
      this.t += DT;
      this.tick++;
      this.shrink(ev);
      this.runStones(ev);
    }
    this.move();
    this.collide(ev);
    if (this.live && !this.over) {
      this.hitStones(ev);
      this.falls(ev);
      this.checkEnd(ev);
    }
    this.splashes(ev);
    return ev;
  }

  // ---- movement ---------------------------------------------------------------------------------

  private move() {
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.removed) continue;
      if (!p.alive) {
        // In the water: carry on drifting for a moment.
        p.fallT += DT;
        const k = Math.exp(-2.2 * DT);
        p.vx *= k;
        p.vz *= k;
        p.x += p.vx * DT;
        p.z += p.vz * DT;
        continue;
      }
      const braced = this.isBraced(i);
      const dashing = this.isDashing(i);
      const sp0 = Math.hypot(p.vx, p.vz);
      if (!braced && !dashing && !this.over) {
        let vx = p.vx + p.sx * ACCEL * DT;
        let vz = p.vz + p.sz * ACCEL * DT;
        const sp = Math.hypot(vx, vz);
        const cap = Math.max(MAX_SPEED, sp0);
        if (sp > cap) {
          vx *= cap / sp;
          vz *= cap / sp;
        }
        p.vx = vx;
        p.vz = vz;
      }
      // Friction.
      const drag = braced || this.over ? BRACE_DRAG : ICE_DRAG;
      const scrape = braced || this.over ? BRACE_SCRAPE : ICE_SCRAPE;
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 0) {
        const ns = Math.max(0, sp - (drag * sp + scrape) * DT);
        p.vx *= ns / sp;
        p.vz *= ns / sp;
      }
      p.x += p.vx * DT;
      p.z += p.vz * DT;
      // Turn to face where you steer (or where you slide).
      const steer = Math.hypot(p.sx, p.sz);
      let target: number | null = null;
      if (steer > 0.2 && !braced) target = Math.atan2(p.sx, p.sz);
      else if (Math.hypot(p.vx, p.vz) > 1.5 && !braced) target = Math.atan2(p.vx, p.vz);
      if (target !== null) p.face += angleDiff(p.face, target) * Math.min(1, 12 * DT);
      if (!this.live) {
        const r = Math.hypot(p.x, p.z);
        if (r > READY_LIMIT) {
          const nx = p.x / r;
          const nz = p.z / r;
          p.x = nx * READY_LIMIT;
          p.z = nz * READY_LIMIT;
          const out = p.vx * nx + p.vz * nz;
          if (out > 0) {
            p.vx -= out * nx;
            p.vz -= out * nz;
          }
        }
      }
    }
  }

  private collide(ev: PushyEvent[]) {
    const ps = this.players;
    const D = PLAYER_R * 2;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (!b.alive) continue;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        if (d >= D) continue;
        if (d < 1e-6) {
          const an = this.rng() * TAU;
          dx = Math.cos(an);
          dz = Math.sin(an);
          d = 1e-6;
        } else {
          dx /= d;
          dz /= d;
        }
        const ma = this.mass(i);
        const mb = this.mass(j);
        const overlap = D - d;
        a.x -= dx * overlap * (mb / (ma + mb));
        a.z -= dz * overlap * (mb / (ma + mb));
        b.x += dx * overlap * (ma / (ma + mb));
        b.z += dz * overlap * (ma / (ma + mb));
        const vn = (b.vx - a.vx) * dx + (b.vz - a.vz) * dz;
        if (vn >= 0) continue;
        const jn = (-(1 + RESTITUTION) * vn) / (1 / ma + 1 / mb);
        a.vx -= (jn / ma) * dx;
        a.vz -= (jn / ma) * dz;
        b.vx += (jn / mb) * dx;
        b.vz += (jn / mb) * dz;
        const dash = this.isDashing(i) || this.isDashing(j);
        const brace = this.isBraced(i) || this.isBraced(j);
        // A lunge spends itself on the first thing it hits.
        if (this.isDashing(i)) a.dashUntil = this.t;
        if (this.isDashing(j)) b.dashUntil = this.t;
        if (-vn >= BIG_BUMP || dash)
          ev.push({ k: 'bump', a: i, b: j, x: a.x + dx * PLAYER_R, z: a.z + dz * PLAYER_R, power: -vn, dash, brace });
      }
    }
  }

  // ---- floe -------------------------------------------------------------------------------------

  private shrink(ev: PushyEvent[]) {
    const gone = new Set<number>();
    for (const s of this.schedule) {
      const c = this.chunks[s.c];
      if (c.state === 0 && this.t >= c.crackAt) {
        c.state = 1;
        ev.push({ k: 'crack', c: c.id });
      }
      if (c.state === 1 && this.t >= c.breakAt) {
        c.state = 2;
        gone.add(c.id);
        ev.push({ k: 'break', c: c.id });
      }
    }
    this.justBroken = gone;
  }
  private justBroken = new Set<number>();

  private falls(ev: PushyEvent[]) {
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive || this.onFloe(p.x, p.z)) continue;
      const id = chunkAt(this.chunks, p.x, p.z);
      p.alive = false;
      p.fellTick = this.tick;
      p.fellAt = this.t;
      p.fallT = 0;
      p.cause = this.lastStoneHit[i] > this.t - 1.5 ? 'stone' : id >= 0 && this.justBroken.has(id) ? 'sink' : 'edge';
      p.braceUntil = p.dashUntil = -1;
      ev.push({ k: 'fall', i, x: p.x, z: p.z, cause: p.cause });
    }
  }

  private splashes(ev: PushyEvent[]) {
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive && !p.removed && !p.splashed && p.fellTick !== null && p.fallT >= 0.35) {
        p.splashed = true;
        ev.push({ k: 'splash', i, x: p.x, z: p.z });
      }
    }
  }
  private lastStoneHit: number[] = [];


  private checkEnd(ev: PushyEvent[]) {
    if (this.over || !this.live) return;
    const alive = this.alive();
    if (alive > 1 && this.t < ROUND_S) return;
    this.over = true;
    this.timeout = alive > 1;
    if (alive > 0) this.winners = this.players.map((p, i) => (p.alive ? i : -1)).filter((i) => i >= 0);
    else {
      // Everyone left went in together: they share it.
      const last = Math.max(...this.players.map((p) => (p.removed || p.fellTick === null ? -1 : p.fellTick)));
      this.winners = this.players.map((p, i) => (!p.removed && p.fellTick === last ? i : -1)).filter((i) => i >= 0);
    }
    ev.push({ k: 'end' });
  }

  /** After the round: points per player (see `roundPoints`). */
  points(): number[] {
    return roundPoints(
      this.players.map((p) => p.fellTick),
      this.players.map((p) => p.removed),
      this.winners,
    );
  }

  // ---- curling stones ---------------------------------------------------------------------------

  private runStones(ev: PushyEvent[]) {
    // Announce the next one a moment before it goes.
    if (this.warned === this.stoneSeq && this.t >= this.nextStone - STONE_WARN_S) {
      this.spawnStone();
      this.warned++;
      ev.push({ k: 'warn', s: this.stones.length - 1 });
    }
    for (let k = 0; k < this.stones.length; k++) {
      const s = this.stones[k];
      if (s.done) continue;
      if (!s.running && this.t >= s.launchAt) {
        s.running = true;
        ev.push({ k: 'launch', s: k });
      }
      if (s.running) {
        s.x += s.dx * STONE_SPEED * DT;
        s.z += s.dz * STONE_SPEED * DT;
        s.spin += DT * 2.2;
        if ((s.x - s.sx) * s.dx + (s.z - s.sz) * s.dz > STONE_START * 2 + 2) s.done = true;
      }
    }
  }

  private spawnStone() {
    const alive = this.players.map((_, i) => i).filter((i) => this.players[i].alive);
    // Stones come from the far side or the sides (so the warning arrow is on screen), never from the near bank.
    const ang = Math.PI + (-Math.PI / 2 + (this.rng() - 0.5) * (Math.PI + 0.6));
    let off = (this.rng() * 2 - 1) * 7;
    if (alive.length && this.rng() < 0.65) {
      // Aim at somebody: slide in from a random side, lined up with where they are now.
      const p = this.players[alive[Math.floor(this.rng() * alive.length)]];
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      off = Math.max(-8, Math.min(8, p.x * -dz + p.z * dx));
    }
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const sx = -dx * STONE_START + -dz * off;
    const sz = -dz * STONE_START + dx * off;
    this.stones.push({ id: this.stoneSeq, x: sx, z: sz, dx, dz, sx, sz, launchAt: this.nextStone, running: false, done: false, spin: this.rng() * TAU });
    this.stoneSeq++;
    this.nextStone += 9 + this.rng() * 4;
  }

  private hitStones(ev: PushyEvent[]) {
    const D = STONE_R + PLAYER_R;
    for (const s of this.stones) {
      if (!s.running || s.done) continue;
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        if (!p.alive) continue;
        let dx = p.x - s.x;
        let dz = p.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d >= D) continue;
        if (d < 1e-6) {
          dx = -s.dz;
          dz = s.dx;
        } else {
          dx /= d;
          dz /= d;
        }
        p.x = s.x + dx * D;
        p.z = s.z + dz * D;
        const vn = (p.vx - s.dx * STONE_SPEED) * dx + (p.vz - s.dz * STONE_SPEED) * dz;
        if (vn >= 0) continue;
        const m = this.mass(i);
        const j = (-(1 + STONE_RESTITUTION) * vn) / (1 / STONE_MASS + 1 / m);
        p.vx += (j / m) * dx;
        p.vz += (j / m) * dz;
        p.dashUntil = -1;
        this.lastStoneHit[i] = this.t;
        ev.push({ k: 'stoneHit', i, x: p.x - dx * PLAYER_R, z: p.z - dz * PLAYER_R, power: -vn });
      }
    }
  }
}

export function howTo(short: boolean): string[] {
  return ['Shove everyone into the water', 'Shove dashes · Brace holds firm', short ? 'Last one on the ice wins' : `Last one on the ice wins · ${PUSHY_ROUNDS} rounds`];
}
