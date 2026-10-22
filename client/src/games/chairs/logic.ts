/**
 * Krzesła ("chairs"): musical chairs at a village wedding. Pure simulation – no DOM, no three.js.
 *
 * A ring of chairs stands in the middle of the hall, one fewer than the players still in. While the
 * band plays, everybody walks round outside the ring (the crowd flows round it, and anyone who wanders
 * inside is gently pushed back out). When the music stops, race to a free chair and press SIT within
 * reach of it: first come, first seated. Press SIT while the music is still playing and you trip
 * ("Too early!"). From the third stop on, the band sometimes only pauses for a moment – sit then and
 * you trip too. Whoever is left standing when the last chair is taken is out; if nobody takes the last
 * chair in time, everybody still standing is out. A chair goes, the band plays again, until one is left.
 *
 * World units are metres, x to the right, z towards the viewer (the TV camera), y up. The ring is
 * centred on the origin.
 */
import type { Rng } from '../rng';
import { eliminationPoints, eliminationWinners } from '../arena/elimination';

export const DT = 1 / 60;

/** Full game / tournament version. */
export const CHAIRS_ROUNDS = 2;
export const CHAIRS_ROUNDS_SHORT = 1;

// ---- movement ------------------------------------------------------------------------------------
export const WALK = 4.4;
/** How quickly the walking velocity follows the stick (per second). */
export const WALK_RESPONSE = 12;
/** While the music plays the crowd flows round the ring at this speed (m/s, anticlockwise from above). */
export const FLOW = 1.2;
/** …and drifts back towards the walking track at up to this speed when you let go of the stick. */
export const TRACK_PULL = 0.7;
/** Players are soft circles of this radius; chairs are solid circles of CHAIR_R. */
export const PLAYER_R = 0.42;
export const CHAIR_R = 0.36;
/** How hard overlapping players push each other apart (per second). */
export const PUSH = 20;
/** How hard the ring pushes walkers back out while the music plays (per second, of the overlap). */
export const KEEP_PUSH = 10;
/** Press SIT with your centre this close to a free chair's centre to take it. */
export const SIT_R = 0.95;
/** Tripped for this long after sitting too early. */
export const STUN_S = 1.2;
/** Where you may walk (the dance floor). */
export const HALL = { x: 7.6, back: -4.4, front: 4.8 } as const;

// ---- timing --------------------------------------------------------------------------------------
/** After GO, a moment before the band strikes up. */
export const WAIT_S = 0.6;
export const MUSIC_MIN = 6;
export const MUSIC_MAX = 14;
/** Fake-outs (the band pauses, then carries on) from this stop on. */
export const FAKE_FROM = 3;
export const FAKE_CHANCE = 0.55;
export const FAKE_S = 0.6;
/** Nobody gets a fake-out this close to the start or the end of the music. */
export const FAKE_EDGE_S = 2;
/** If the last chair is still free this long after the music stops, everybody standing is out. */
export const SCRAMBLE_S = 8;
/** The one left standing tumbles off… */
export const OUT_S = 2.4;
/** …then everybody gets up, a chair goes, and the band plays again. */
export const SETUP_S = 1.8;
/** Playing on your own: one chair, this many stops. */
export const SOLO_STOPS = 5;

// ---- the ring ------------------------------------------------------------------------------------
/** How many chairs there are with `alive` players still in. */
export function chairsFor(alive: number, solo = false): number {
  return solo ? 1 : Math.max(1, alive - 1);
}

/** Radius of the ring of chair centres for `n` chairs. */
export function ringRadius(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 0.75;
  return Math.max(1.45, (n * 1.5) / (2 * Math.PI));
}

/** Walkers are kept outside this radius while the music plays. */
export const keepRadius = (n: number) => ringRadius(n) + 1.0;
/** The crowd's walking track (where the flow drifts idle players to). */
export const trackRadius = (n: number) => keepRadius(n) + 1.0;

export interface Chair {
  id: number;
  x: number;
  z: number;
  /** The way the chair faces (outwards), as an angle in the x–z plane: (cos a, sin a). */
  a: number;
  /** Who sits on it (player index), or -1. */
  by: number;
}

/** Where `n` chairs stand: a ring facing outwards (two back to back; one on its own in the middle). */
export function ringLayout(n: number): { x: number; z: number; a: number }[] {
  if (n <= 0) return [];
  if (n === 1) return [{ x: 0, z: 0, a: Math.PI / 2 }];
  const r = ringRadius(n);
  const off = n === 2 ? 0 : Math.PI / 2;
  return Array.from({ length: n }, (_, i) => {
    const a = off + (i / n) * Math.PI * 2;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, a };
  });
}

/** The yaw that faces along angle `a` (a model faces +z at yaw 0). */
export const yawFor = (a: number) => Math.atan2(Math.cos(a), Math.sin(a));

// ---- the music -----------------------------------------------------------------------------------
export interface MusicPlan {
  /** How long the band plays before it stops for real (fake-outs included). */
  dur: number;
  /** When fake-outs start (seconds into the music), in order. */
  fakes: number[];
}

/** How long the music plays at stop `n` (1-based) and where the fake-outs go. */
export function musicPlan(n: number, rng: Rng): MusicPlan {
  const dur = MUSIC_MIN + rng() * (MUSIC_MAX - MUSIC_MIN);
  const fakes: number[] = [];
  if (n >= FAKE_FROM && rng() < FAKE_CHANCE) {
    const span = dur - 2 * FAKE_EDGE_S - FAKE_S;
    const t = FAKE_EDGE_S + rng() * span;
    fakes.push(t);
    // A long tune may fool you twice.
    if (dur > 11 && rng() < 0.35) {
      const t2 = t + FAKE_S + 2.5 + rng() * 2;
      if (t2 < dur - FAKE_EDGE_S - FAKE_S) fakes.push(t2);
    }
  }
  return { dur, fakes };
}

/** The band speeds up a little with every stop: seconds per eighth note. */
export const eighthFor = (n: number) => Math.max(0.118, 0.152 - 0.005 * Math.max(0, n - 1));

// ---- players -------------------------------------------------------------------------------------
export interface ChairsPlayer {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Yaw (0 = facing +z). */
  face: number;
  alive: boolean;
  gone: boolean;
  /** The stop this player went out at. */
  outAt: number | null;
  /** The chair id this player sits on, or -1. */
  seat: number;
  /** Seconds left lying on the floor after sitting too early. */
  stun: number;
  trips: number;
  /** Chairs taken this round. */
  sits: number;
}

export interface ChairsInput {
  x: number;
  z: number;
  /** SIT presses since the last step. */
  sit: number;
}

export type ChairsPhase = 'idle' | 'wait' | 'music' | 'scramble' | 'out' | 'setup' | 'done';

export type ChairsEvent =
  | { t: 'music'; n: number; dur: number; chairs: number }
  | { t: 'fake'; on: boolean }
  | { t: 'stop'; n: number }
  | { t: 'trip'; i: number; fake: boolean }
  | { t: 'sit'; i: number; chair: number }
  | { t: 'out'; n: number; idx: number[]; timeout: boolean }
  | { t: 'setup'; n: number; removed: number[] }
  | { t: 'over' };

export interface ChairsOpts {
  rng?: Rng;
  /** Players who already left the game. */
  gone?: boolean[];
  /** Override the music plan (tests). */
  plan?: (n: number, rng: Rng) => MusicPlan;
}

export class ChairsSim {
  readonly players: ChairsPlayer[];
  chairs: Chair[] = [];
  phase: ChairsPhase = 'idle';
  phaseT = 0;
  time = 0;
  /** The stop we are on (1-based once the band first plays). */
  n = 0;
  plan: MusicPlan = { dur: 0, fakes: [] };
  /** Seconds left in the current fake-out (0: none). */
  fakeT = 0;
  over = false;
  readonly solo: boolean;
  private fakeIdx = 0;
  private nextChair = 0;
  private pending: ChairsEvent[] = [];
  private rng: Rng;
  private planFor: (n: number, rng: Rng) => MusicPlan;

  constructor(count: number, opts: ChairsOpts = {}) {
    this.rng = opts.rng ?? Math.random;
    this.planFor = opts.plan ?? musicPlan;
    const gone = opts.gone ?? [];
    const live = Array.from({ length: count }, (_, i) => i).filter((i) => !gone[i]);
    this.solo = live.length <= 1;
    const nChairs = chairsFor(live.length, this.solo);
    const tr = trackRadius(nChairs);
    this.players = Array.from({ length: count }, (_, i) => {
      const k = Math.max(0, live.indexOf(i));
      const a = Math.PI / 2 + (k / Math.max(1, live.length)) * Math.PI * 2 + Math.PI / Math.max(1, nChairs);
      return {
        x: Math.cos(a) * tr,
        z: Math.sin(a) * tr,
        vx: 0,
        vz: 0,
        face: yawFor(a + Math.PI / 2),
        alive: !gone[i],
        gone: !!gone[i],
        outAt: null,
        seat: -1,
        stun: 0,
        trips: 0,
        sits: 0,
      };
    });
    this.layout(nChairs);
  }

  get aliveCount() {
    return this.players.filter((p) => p.alive && !p.gone).length;
  }

  /** The music can be heard (not stopped, not in a fake-out). */
  get musicOn() {
    return this.phase === 'music' && this.fakeT <= 0;
  }

  get freeChairs() {
    return this.chairs.filter((c) => c.by < 0).length;
  }

  /** Seconds left to grab the last chair. */
  get scrambleLeft() {
    return this.phase === 'scramble' ? Math.max(0, SCRAMBLE_S - this.phaseT) : 0;
  }

  begin() {
    if (this.phase !== 'idle') return;
    this.phase = 'wait';
    this.phaseT = 0;
  }

  /** A player left the game. Chairs are taken away so there is still one fewer than the players. */
  remove(i: number) {
    const p = this.players[i];
    if (!p || p.gone) return;
    p.gone = true;
    p.alive = false;
    if (p.seat >= 0) {
      // Their chair leaves with them.
      this.chairs = this.chairs.filter((c) => c.id !== p.seat);
      p.seat = -1;
    }
    if (this.phase === 'done') return;
    const alive = this.aliveCount;
    const finished = this.solo ? alive === 0 : alive <= 1;
    if (finished) {
      this.over = true;
      if (this.phase !== 'out') {
        this.phase = 'done';
        this.phaseT = 0;
        this.pending.push({ t: 'over' });
      }
      return;
    }
    const target = chairsFor(alive, this.solo);
    if (this.phase === 'scramble') {
      // Mid-scramble: take away free chairs (the ones furthest from anybody still standing).
      while (this.chairs.length > target) {
        const free = this.chairs.filter((c) => c.by < 0);
        if (!free.length) break;
        const standing = this.players.filter((q) => q.alive && !q.gone && q.seat < 0);
        const far = (c: Chair) => Math.min(Infinity, ...standing.map((q) => Math.hypot(q.x - c.x, q.z - c.z)));
        free.sort((a, b) => far(b) - far(a) || a.id - b.id);
        this.chairs = this.chairs.filter((c) => c.id !== free[0].id);
      }
      if (this.freeChairs === 0) this.resolve(false, this.pending);
    } else if (this.phase !== 'out' && this.chairs.length > target) {
      this.layout(target);
    }
  }

  step(inputs: readonly ChairsInput[]): ChairsEvent[] {
    const ev: ChairsEvent[] = this.pending;
    this.pending = [];
    this.time += DT;
    this.phaseT += DT;
    this.presses(inputs, ev);
    switch (this.phase) {
      case 'wait':
        if (this.phaseT >= WAIT_S) this.startMusic(ev);
        break;
      case 'music':
        if (this.fakeT > 0) {
          this.fakeT -= DT;
          if (this.fakeT <= 1e-9) {
            this.fakeT = 0;
            ev.push({ t: 'fake', on: false });
          }
        }
        if (this.fakeT <= 0 && this.fakeIdx < this.plan.fakes.length && this.phaseT >= this.plan.fakes[this.fakeIdx]) {
          this.fakeIdx++;
          this.fakeT = FAKE_S;
          ev.push({ t: 'fake', on: true });
        }
        if (this.fakeT <= 0 && this.phaseT >= this.plan.dur) {
          this.phase = 'scramble';
          this.phaseT = 0;
          ev.push({ t: 'stop', n: this.n });
        }
        break;
      case 'scramble':
        if (this.phaseT >= SCRAMBLE_S) this.resolve(true, ev);
        break;
      case 'out':
        if (this.phaseT >= OUT_S) {
          if (this.over) {
            this.phase = 'done';
            this.phaseT = 0;
            ev.push({ t: 'over' });
          } else this.setup(ev);
        }
        break;
      case 'setup':
        if (this.phaseT >= SETUP_S) this.startMusic(ev);
        break;
    }
    this.move(inputs);
    return ev;
  }

  // ---- flow ------------------------------------------------------------------------------------------

  private layout(n: number) {
    const spots = ringLayout(n);
    const keep = this.chairs.slice(0, n);
    this.chairs = spots.map((s, k) => ({ id: keep[k]?.id ?? this.nextChair++, x: s.x, z: s.z, a: s.a, by: -1 }));
  }

  private startMusic(ev: ChairsEvent[]) {
    this.n++;
    this.plan = this.planFor(this.n, this.rng);
    this.fakeIdx = 0;
    this.fakeT = 0;
    this.phase = 'music';
    this.phaseT = 0;
    ev.push({ t: 'music', n: this.n, dur: this.plan.dur, chairs: this.chairs.length });
  }

  private resolve(timeout: boolean, ev: ChairsEvent[]) {
    const idx: number[] = [];
    this.players.forEach((p, i) => {
      if (!p.alive || p.gone || p.seat >= 0) return;
      p.alive = false;
      p.outAt = this.n;
      p.stun = 0;
      idx.push(i);
    });
    this.phase = 'out';
    this.phaseT = 0;
    ev.push({ t: 'out', n: this.n, idx, timeout });
    const alive = this.aliveCount;
    if (this.solo ? alive === 0 || this.n >= SOLO_STOPS : alive <= 1) this.over = true;
  }

  /** Everybody gets up, a chair goes, and the ring closes up. */
  private setup(ev: ChairsEvent[]) {
    const before = this.chairs.map((c) => c.id);
    const target = chairsFor(this.aliveCount, this.solo);
    this.players.forEach((p) => {
      if (p.seat < 0) return;
      const c = this.chairs.find((q) => q.id === p.seat);
      p.seat = -1;
      if (!c) return;
      // Stand up and step out in front of the chair.
      const out = keepRadius(target) + 0.2;
      const r = Math.hypot(c.x, c.z);
      const dx = r > 0.01 ? c.x / r : Math.cos(c.a);
      const dz = r > 0.01 ? c.z / r : Math.sin(c.a);
      p.x = dx * out;
      p.z = dz * out;
      p.vx = p.vz = 0;
    });
    // Take one away at random, then close up the ring.
    while (this.chairs.length > target) this.chairs.splice(Math.floor(this.rng() * this.chairs.length), 1);
    this.layout(target);
    const now = new Set(this.chairs.map((c) => c.id));
    this.phase = 'setup';
    this.phaseT = 0;
    ev.push({ t: 'setup', n: this.n, removed: before.filter((id) => !now.has(id)) });
  }

  // ---- input -----------------------------------------------------------------------------------------

  private presses(inputs: readonly ChairsInput[], ev: ChairsEvent[]) {
    const want: { i: number; d: number }[] = [];
    this.players.forEach((p, i) => {
      const n = inputs[i]?.sit ?? 0;
      if (n <= 0 || !p.alive || p.gone || p.seat >= 0 || p.stun > 0) return;
      if (this.phase === 'music') {
        p.stun = STUN_S;
        p.trips++;
        p.vx *= 0.3;
        p.vz *= 0.3;
        ev.push({ t: 'trip', i, fake: this.fakeT > 0 });
      } else if (this.phase === 'scramble') {
        const c = this.nearestFree(p);
        if (c) want.push({ i, d: c.d });
      }
    });
    // First come, first seated: the closest to their chair wins a same-frame race.
    want.sort((a, b) => a.d - b.d || a.i - b.i);
    for (const w of want) {
      const p = this.players[w.i];
      const c = this.nearestFree(p);
      if (!c) continue;
      c.chair.by = w.i;
      p.seat = c.chair.id;
      p.sits++;
      p.x = c.chair.x;
      p.z = c.chair.z;
      p.vx = p.vz = 0;
      p.face = yawFor(c.chair.a);
      ev.push({ t: 'sit', i: w.i, chair: c.chair.id });
    }
    if (this.phase === 'scramble' && want.length && this.freeChairs === 0) this.resolve(false, ev);
  }

  /** The nearest free chair within reach of `p`. */
  nearestFree(p: { x: number; z: number }): { chair: Chair; d: number } | null {
    let best: Chair | null = null;
    let bd = Infinity;
    for (const c of this.chairs) {
      if (c.by >= 0) continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d <= SIT_R && d < bd) {
        bd = d;
        best = c;
      }
    }
    return best ? { chair: best, d: bd } : null;
  }

  // ---- movement --------------------------------------------------------------------------------------

  private move(inputs: readonly ChairsInput[]) {
    if (this.phase === 'done') return;
    const n = this.chairs.length;
    const keep = keepRadius(n);
    const track = trackRadius(n);
    const keepOut = this.phase !== 'scramble' && this.phase !== 'out';
    const flowing = this.phase === 'music' || this.phase === 'wait';
    const k = 1 - Math.exp(-WALK_RESPONSE * DT);
    const walkers: ChairsPlayer[] = [];
    this.players.forEach((p, i) => {
      if (!p.alive || p.gone || p.seat >= 0) return;
      walkers.push(p);
      const inp = inputs[i] ?? { x: 0, z: 0, sit: 0 };
      let ix = Number.isFinite(inp.x) ? inp.x : 0;
      let iz = Number.isFinite(inp.z) ? inp.z : 0;
      const il = Math.hypot(ix, iz);
      if (il > 1) {
        ix /= il;
        iz /= il;
      }
      const stunned = p.stun > 0;
      if (stunned) {
        p.stun = Math.max(0, p.stun - DT);
        ix = iz = 0;
      }
      p.vx += (ix * WALK - p.vx) * k;
      p.vz += (iz * WALK - p.vz) * k;
      if (!stunned && Math.hypot(p.vx, p.vz) > 0.6) p.face = Math.atan2(p.vx, p.vz);
      let fx = 0;
      let fz = 0;
      const r = Math.hypot(p.x, p.z);
      if (flowing && !stunned && r > 0.01) {
        // The crowd flows round the ring (anticlockwise seen from above: +x towards -z).
        const tx = p.z / r;
        const tz = -p.x / r;
        const pull = Math.max(-TRACK_PULL, Math.min(TRACK_PULL, (track - r) * 0.8)) * (1 - Math.min(1, il));
        fx = tx * FLOW + (p.x / r) * pull;
        fz = tz * FLOW + (p.z / r) * pull;
        if (il < 0.2) p.face = Math.atan2(tx, tz);
      }
      p.x += (p.vx + fx) * DT;
      p.z += (p.vz + fz) * DT;
      if (keepOut) {
        const r2 = Math.hypot(p.x, p.z);
        if (r2 < keep) {
          const nx = r2 > 1e-6 ? p.x / r2 : 0;
          const nz = r2 > 1e-6 ? p.z / r2 : 1;
          const push = (keep - r2) * Math.min(1, KEEP_PUSH * DT);
          p.x += nx * push;
          p.z += nz * push;
        }
      }
    });

    // Soft circles: walkers shove each other; chairs and seated players don't budge.
    for (let iter = 0; iter < 2; iter++) {
      for (let a = 0; a < walkers.length; a++) {
        const A = walkers[a];
        for (let b = a + 1; b < walkers.length; b++) {
          const B = walkers[b];
          const dx = B.x - A.x;
          const dz = B.z - A.z;
          const d = Math.hypot(dx, dz);
          const min = PLAYER_R * 2;
          if (d >= min) continue;
          const nx = d > 1e-6 ? dx / d : Math.cos(a * 2.4 + b);
          const nz = d > 1e-6 ? dz / d : Math.sin(a * 2.4 + b);
          const push = (min - d) * Math.min(1, PUSH * DT) * 0.5;
          A.x -= nx * push;
          A.z -= nz * push;
          B.x += nx * push;
          B.z += nz * push;
        }
      }
      for (const p of walkers) {
        for (const c of this.chairs) {
          const min = PLAYER_R + (c.by >= 0 ? PLAYER_R : CHAIR_R);
          const dx = p.x - c.x;
          const dz = p.z - c.z;
          const d = Math.hypot(dx, dz);
          if (d >= min) continue;
          const nx = d > 1e-6 ? dx / d : Math.cos(c.a);
          const nz = d > 1e-6 ? dz / d : Math.sin(c.a);
          p.x = c.x + nx * min;
          p.z = c.z + nz * min;
        }
      }
    }
    for (const p of walkers) {
      p.x = Math.max(-HALL.x, Math.min(HALL.x, p.x));
      p.z = Math.max(HALL.back, Math.min(HALL.front, p.z));
    }
  }

  results() {
    const outAt = this.players.map((p) => p.outAt);
    const gone = this.players.map((p) => p.gone);
    return {
      points: eliminationPoints(outAt, gone, this.solo, this.n),
      winners: eliminationWinners(outAt, gone, this.solo),
      stops: this.n,
    };
  }
}

export function howTo(short: boolean): string[] {
  return ['Walk round the chairs while the band plays', 'Music stops: run to a chair and SIT! (not before)', short ? 'One round · last one seated wins' : 'Two rounds · last one seated wins'];
}
