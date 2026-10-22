/**
 * Korona: the pure rules. No DOM, no three.js. A keep-away game in the arcaded courtyard of Wawel
 * castle, in the spirit of Mario Party's crown-stealing minigames.
 *
 * One golden crown. Touch it while it lies loose and it's yours: every second you wear it scores a
 * point (two in the last ten seconds), but you walk a little slower. Everybody has a Dash; dash into
 * whoever wears the crown and it flies off their head in an arc, lands a few metres away, and they
 * are dazed for a moment. A fresh wearer can't be robbed for a second.
 *
 * World units are metres, y is up. The courtyard is a rectangle centred on the origin (x across the
 * TV, +z towards the viewer) with the fountain in the middle and four columns round it.
 */
import { mulberry32, type Rng } from '../rng';

export { mulberry32 };
export type { Rng };

export const DT = 1 / 60;

// ---- the round ------------------------------------------------------------------------------------
export const ROUND_S = 60;
/** The last this-many seconds of a round score double. */
export const DOUBLE_S = 10;
export const ROUNDS = 2;
export const ROUNDS_SHORT = 1;
/** Scoring is counted in steps: one step worn is one tick, two during double time. */
export const TICKS_PER_POINT = 60;

// ---- the courtyard --------------------------------------------------------------------------------
/** Half the walkable width (x) and depth (z). */
export const HALF_W = 12.5;
export const HALF_D = 7.2;
export const FOUNTAIN_R = 2.1;
export const COLUMN_R = 0.55;
export const COLUMNS: readonly { x: number; z: number }[] = [
  { x: -6.8, z: -3.6 },
  { x: 6.8, z: -3.6 },
  { x: -6.8, z: 3.6 },
  { x: 6.8, z: 3.6 },
];
/** Round obstacles: the fountain basin and the columns. */
export const OBSTACLES: readonly { x: number; z: number; r: number }[] = [{ x: 0, z: 0, r: FOUNTAIN_R }, ...COLUMNS.map((c) => ({ ...c, r: COLUMN_R }))];

// ---- moving ---------------------------------------------------------------------------------------
export const PLAYER_R = 0.7;
export const WALK = 6.2;
export const ACCEL = 48;
export const DEADZONE = 0.14;
/** The wearer walks (and dashes) this much slower. */
export const CROWN_SLOW = 0.85;

export const DASH_TIME = 0.24;
export const DASH_SPEED = 16;
export const DASH_CD = 2.5;
/** A Dash pressed this long before it is ready still happens. */
export const BUFFER = 0.2;
/** A dash this close to the wearer knocks the crown off. */
export const HIT_R = PLAYER_R * 2 + 0.3;
export const DAZE = 0.8;
/** A new wearer can't be robbed for this long. */
export const IMMUNE = 1;

// ---- the crown ------------------------------------------------------------------------------------
/** How close you have to be to a loose crown to put it on. */
export const PICK_R = PLAYER_R + 0.55;
export const KNOCK_MIN = 3;
export const KNOCK_MAX = 5;
export const FLIGHT = 0.75;
export const KNOCK_H = 2.6;
/** At GO the fountain spits the crown out, this far from the middle. */
export const START_MIN = 3.4;
export const START_MAX = 4.4;
export const START_FLIGHT = 1.1;
/** Height of the crown on top of the fountain, and on a wearer's head. */
export const FOUNTAIN_TOP = 3.1;
export const HEAD_Y = 1.25;
/** The crown lands at least this far inside walls and away from obstacles. */
export const CROWN_CLEAR = 0.45;

export interface CrownInput {
  /** Joystick, -1..1 each; +x right, +z towards the viewer. */
  x: number;
  z: number;
  /** Dash pressed since the last step. */
  dash?: boolean;
}

export interface CrownPlayer {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing (unit vector). */
  fx: number;
  fz: number;
  /** Seconds of dash left, and its direction. */
  dash: number;
  dx: number;
  dz: number;
  dashCd: number;
  dashBuf: number;
  /** Seconds dazed. */
  daze: number;
  /** Removed from the game. */
  gone: boolean;
  /** Disconnected: can't pick the crown up (and drops it). */
  away: boolean;
  /** Scoring ticks this round (see TICKS_PER_POINT). */
  ticks: number;
  steals: number;
  /** How far the stick is pushed (0..1), for walk animations. */
  speed: number;
}

export type CrownState = 'held' | 'flying' | 'loose';

export interface Crown {
  state: CrownState;
  /** Who wears it (-1: nobody). */
  wearer: number;
  x: number;
  y: number;
  z: number;
  /** A flight: from (sx, sy, sz) to (tx, 0, tz), `t` of `dur` seconds, peaking `h` above the higher end. */
  sx: number;
  sy: number;
  sz: number;
  tx: number;
  tz: number;
  t: number;
  dur: number;
  h: number;
  /** Seconds the current wearer is still safe from steals. */
  immune: number;
}

export type CrownEvent =
  | { t: 'launch'; x: number; z: number }
  | { t: 'dash'; p: number }
  | { t: 'pickup'; p: number; first: boolean }
  | { t: 'steal'; by: number; from: number; tx: number; tz: number }
  | { t: 'bump'; p: number; by: number }
  | { t: 'drop'; p: number; tx: number; tz: number }
  | { t: 'land'; x: number; z: number }
  | { t: 'double' }
  | { t: 'over' };

export type SimPhase = 'idle' | 'play' | 'done';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Push a point out of the obstacles and back inside the walls, keeping `clear` metres from all of them. */
export function settle(x: number, z: number, clear: number) {
  for (let pass = 0; pass < 3; pass++) {
    x = clamp(x, -HALF_W + clear, HALF_W - clear);
    z = clamp(z, -HALF_D + clear, HALF_D - clear);
    for (const o of OBSTACLES) {
      const dx = x - o.x;
      const dz = z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + clear;
      if (d >= min) continue;
      // Straight out from the middle; a point dead in the centre goes towards the viewer.
      const nx = d > 1e-6 ? dx / d : 0;
      const nz = d > 1e-6 ? dz / d : 1;
      x = o.x + nx * min;
      z = o.z + nz * min;
    }
  }
  return { x, z };
}

/** True if (x, z) is inside the walls and clear of every obstacle by `clear`. */
export function isClear(x: number, z: number, clear: number) {
  if (Math.abs(x) > HALF_W - clear + 1e-6 || Math.abs(z) > HALF_D - clear + 1e-6) return false;
  return OBSTACLES.every((o) => Math.hypot(x - o.x, z - o.z) >= o.r + clear - 1e-6);
}

/** Where player `i` of `n` starts: on an oval round the fountain, the first one in front. */
export function spawnAt(i: number, n: number) {
  const a = Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
  return settle(Math.cos(a) * 9, Math.sin(a) * 5.4, PLAYER_R + 0.05);
}

/** Points for a number of ticks. */
export const pointsFor = (ticks: number) => Math.floor(ticks / TICKS_PER_POINT + 1e-9);

export interface CrownOptions {
  rng?: Rng;
  /** Round length, seconds. */
  length?: number;
  /** Players removed before the round started. */
  gone?: readonly boolean[];
}

export class CrownSim {
  readonly n: number;
  readonly length: number;
  readonly players: CrownPlayer[];
  readonly crown: Crown;
  phase: SimPhase = 'idle';
  time = 0;
  /** Steps played; the round lasts `totalSteps`. */
  steps = 0;
  readonly totalSteps: number;
  /** Whoever wore the crown first this round (-1: nobody yet). */
  firstWearer = -1;
  private rng: Rng;
  private events: CrownEvent[] = [];
  private doubled = false;

  constructor(n: number, opts: CrownOptions = {}) {
    this.n = n;
    this.rng = opts.rng ?? Math.random;
    this.length = opts.length ?? ROUND_S;
    this.totalSteps = Math.round(this.length / DT);
    this.players = Array.from({ length: n }, (_, i) => {
      const s = spawnAt(i, n);
      const len = Math.hypot(s.x, s.z) || 1;
      return {
        x: s.x,
        z: s.z,
        vx: 0,
        vz: 0,
        fx: -s.x / len,
        fz: -s.z / len,
        dash: 0,
        dx: 0,
        dz: 1,
        dashCd: 0,
        dashBuf: 0,
        daze: 0,
        gone: !!opts.gone?.[i],
        away: false,
        ticks: 0,
        steals: 0,
        speed: 0,
      };
    });
    this.crown = { state: 'flying', wearer: -1, x: 0, y: FOUNTAIN_TOP, z: 0, sx: 0, sy: FOUNTAIN_TOP, sz: 0, tx: 0, tz: 0, t: 0, dur: START_FLIGHT, h: 1.6, immune: 0 };
  }

  get left() {
    return Math.max(0, (this.totalSteps - this.steps) * DT);
  }
  get done() {
    return this.phase === 'done';
  }
  /** The last DOUBLE_S seconds: worn time counts twice. */
  get double() {
    return this.phase === 'play' && this.totalSteps - this.steps < Math.round(DOUBLE_S / DT);
  }
  get wearer() {
    return this.crown.state === 'held' ? this.crown.wearer : -1;
  }
  points(i: number) {
    const p = this.players[i];
    return p && !p.gone ? pointsFor(p.ticks) : 0;
  }
  get active() {
    return this.players.filter((p) => !p.gone).length;
  }

  /** GO: the fountain spits the crown out to a random spot round it. */
  begin() {
    if (this.phase !== 'idle') return [];
    this.phase = 'play';
    const ev: CrownEvent[] = (this.events = []);
    const a = this.rng() * Math.PI * 2;
    const d = START_MIN + this.rng() * (START_MAX - START_MIN);
    const t = settle(Math.cos(a) * d, Math.sin(a) * d, CROWN_CLEAR);
    this.fly(0, FOUNTAIN_TOP, 0, t.x, t.z, START_FLIGHT, 2.2);
    ev.push({ t: 'launch', x: t.x, z: t.z });
    return ev;
  }

  step(inputs: readonly (CrownInput | undefined)[]): CrownEvent[] {
    const ev: CrownEvent[] = (this.events = []);
    if (this.phase !== 'play') return ev;
    this.steps++;
    this.time = this.steps * DT;
    if (!this.doubled && this.double) {
      this.doubled = true;
      ev.push({ t: 'double' });
    }
    for (let i = 0; i < this.n; i++) this.control(i, inputs[i]);
    this.collide();
    this.tickCrown();
    // Scoring: the wearer's tick for this step.
    const w = this.wearer;
    if (w >= 0) this.players[w].ticks += this.double ? 2 : 1;
    if (this.steps >= this.totalSteps) {
      this.phase = 'done';
      ev.push({ t: 'over' });
    }
    return ev;
  }

  // ---- players ----------------------------------------------------------------------------------

  private control(i: number, inp: CrownInput = { x: 0, z: 0 }) {
    const p = this.players[i];
    if (p.gone) return;
    p.dashCd = Math.max(0, p.dashCd - DT);
    p.dashBuf = Math.max(0, p.dashBuf - DT);
    if (inp.dash) p.dashBuf = BUFFER;
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
    const slow = this.wearer === i ? CROWN_SLOW : 1;
    if (p.daze > 0) {
      p.daze = Math.max(0, p.daze - DT);
      p.dash = 0;
      const k = Math.exp(-4 * DT);
      p.vx *= k;
      p.vz *= k;
      p.speed = 0;
    } else if (p.dash > 0) {
      p.dash = Math.max(0, p.dash - DT);
      p.vx = p.dx * DASH_SPEED * slow;
      p.vz = p.dz * DASH_SPEED * slow;
      this.dashHits(i);
      if (p.dash === 0) {
        p.vx *= 0.3;
        p.vz *= 0.3;
      }
    } else {
      const tx = mx * WALK * slow;
      const tz = mz * WALK * slow;
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
      if (p.dashBuf > 0 && p.dashCd <= 0 && !p.away) this.startDash(i);
    }
    p.x += p.vx * DT;
    p.z += p.vz * DT;
  }

  private startDash(i: number) {
    const p = this.players[i];
    p.dash = DASH_TIME;
    p.dx = p.fx;
    p.dz = p.fz;
    p.dashCd = DASH_CD;
    p.dashBuf = 0;
    this.events.push({ t: 'dash', p: i });
  }

  /** A dash that reaches the wearer knocks the crown off; anyone else just gets bumped. */
  private dashHits(i: number) {
    const p = this.players[i];
    for (let j = 0; j < this.n; j++) {
      const o = this.players[j];
      if (j === i || o.gone) continue;
      if (Math.hypot(o.x - p.x, o.z - p.z) > HIT_R) continue;
      // Only hits someone in front of the dash.
      if ((o.x - p.x) * p.dx + (o.z - p.z) * p.dz < -0.2) continue;
      if (j === this.wearer && this.crown.immune <= 0) {
        this.knockOff(j, i);
        p.dash = 0;
        p.vx = -p.dx * 2;
        p.vz = -p.dz * 2;
        return;
      }
      if (j !== this.wearer && o.dash <= 0 && o.daze <= 0) {
        // A shove, but no daze.
        o.vx += p.dx * 6;
        o.vz += p.dz * 6;
        p.dash = 0;
        p.vx *= 0.25;
        p.vz *= 0.25;
        this.events.push({ t: 'bump', p: j, by: i });
        return;
      }
    }
  }

  /** `by` dashed into the wearer `from`: the crown flies off in a random direction. */
  knockOff(from: number, by: number) {
    const w = this.players[from];
    const a = this.rng() * Math.PI * 2;
    const d = KNOCK_MIN + this.rng() * (KNOCK_MAX - KNOCK_MIN);
    const t = settle(w.x + Math.cos(a) * d, w.z + Math.sin(a) * d, CROWN_CLEAR);
    this.fly(w.x, HEAD_Y, w.z, t.x, t.z, FLIGHT, KNOCK_H);
    w.daze = DAZE;
    w.dash = 0;
    const by_ = this.players[by];
    if (by_) {
      w.vx = by_.dx * 7;
      w.vz = by_.dz * 7;
      by_.steals++;
    }
    this.events.push({ t: 'steal', by, from, tx: t.x, tz: t.z });
  }

  /** Soft circles: players push each other apart, and are pushed out of obstacles and walls. */
  private collide() {
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
        const wa = a.dash > 0 ? 0.2 : b.dash > 0 ? 0.8 : 0.5;
        a.x -= nx * push * wa;
        a.z -= nz * push * wa;
        b.x += nx * push * (1 - wa);
        b.z += nz * push * (1 - wa);
      }
    }
    for (const p of this.players) {
      if (p.gone) continue;
      for (const o of OBSTACLES) {
        const dx = p.x - o.x;
        const dz = p.z - o.z;
        const d = Math.hypot(dx, dz);
        const min = o.r + PLAYER_R;
        if (d >= min) continue;
        const nx = d > 1e-6 ? dx / d : 0;
        const nz = d > 1e-6 ? dz / d : 1;
        p.x = o.x + nx * min;
        p.z = o.z + nz * min;
        // Lose the speed going into it, so you slide round.
        const into = p.vx * nx + p.vz * nz;
        if (into < 0) {
          p.vx -= into * nx;
          p.vz -= into * nz;
        }
      }
      const mx = HALF_W - PLAYER_R;
      const mz = HALF_D - PLAYER_R;
      if (Math.abs(p.x) > mx) {
        p.x = clamp(p.x, -mx, mx);
        p.vx = 0;
      }
      if (Math.abs(p.z) > mz) {
        p.z = clamp(p.z, -mz, mz);
        p.vz = 0;
      }
    }
  }

  // ---- the crown --------------------------------------------------------------------------------

  private fly(sx: number, sy: number, sz: number, tx: number, tz: number, dur: number, h: number) {
    const c = this.crown;
    c.state = 'flying';
    c.wearer = -1;
    c.sx = sx;
    c.sy = sy;
    c.sz = sz;
    c.tx = tx;
    c.tz = tz;
    c.t = 0;
    c.dur = dur;
    c.h = h;
    c.immune = 0;
    c.x = sx;
    c.y = sy;
    c.z = sz;
  }

  private tickCrown() {
    const c = this.crown;
    if (c.state === 'held') {
      c.immune = Math.max(0, c.immune - DT);
      const w = this.players[c.wearer];
      c.x = w.x;
      c.z = w.z;
      c.y = HEAD_Y;
      return;
    }
    if (c.state === 'flying') {
      c.t += DT;
      const k = Math.min(1, c.t / c.dur);
      c.x = c.sx + (c.tx - c.sx) * k;
      c.z = c.sz + (c.tz - c.sz) * k;
      // A parabola from sy to 0 that peaks h above the start.
      const top = c.sy + c.h;
      const a = Math.sqrt(top);
      const b = Math.sqrt(Math.max(0, top - c.sy));
      // y(k) = top - (( (a + b) k - b )^2), so y(0) = sy and y(1) = 0.
      const u = (a + b) * k - b;
      c.y = Math.max(0, top - u * u);
      if (k >= 1) {
        c.state = 'loose';
        c.x = c.tx;
        c.z = c.tz;
        c.y = 0;
        this.events.push({ t: 'land', x: c.x, z: c.z });
      } else return;
    }
    // Loose: the nearest player who can touches it first.
    let best = -1;
    let bestD = PICK_R;
    this.players.forEach((p, i) => {
      if (p.gone || p.away || p.daze > 0) return;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d <= bestD) {
        if (d === bestD && best >= 0) return;
        best = i;
        bestD = d;
      }
    });
    if (best >= 0) this.give(best);
  }

  /** Put the crown on player `i` (it's theirs whatever state it was in). */
  give(i: number) {
    const p = this.players[i];
    if (!p || p.gone) return;
    const c = this.crown;
    c.state = 'held';
    c.wearer = i;
    c.immune = IMMUNE;
    c.x = p.x;
    c.z = p.z;
    c.y = HEAD_Y;
    const first = this.firstWearer < 0;
    if (first) this.firstWearer = i;
    this.events.push({ t: 'pickup', p: i, first });
  }

  /** The wearer leaves (or drops out): the crown falls off where they stood. */
  private dropFrom(i: number) {
    if (this.wearer !== i) return;
    const p = this.players[i];
    const t = settle(p.x, p.z + 0.01, CROWN_CLEAR);
    this.fly(p.x, HEAD_Y, p.z, t.x, t.z, 0.45, 0.8);
    this.events.push({ t: 'drop', p: i, tx: t.x, tz: t.z });
  }

  /** A player leaves for good. Returns the events (a dropped crown). */
  remove(i: number): CrownEvent[] {
    const p = this.players[i];
    const ev: CrownEvent[] = (this.events = []);
    if (!p || p.gone) return ev;
    this.dropFrom(i);
    p.gone = true;
    p.dash = 0;
    p.vx = p.vz = 0;
    return ev;
  }

  /** A player's phone dropped out (or came back). An away wearer drops the crown. */
  setAway(i: number, away: boolean): CrownEvent[] {
    const p = this.players[i];
    const ev: CrownEvent[] = (this.events = []);
    if (!p || p.gone || p.away === away) return ev;
    p.away = away;
    if (away) this.dropFrom(i);
    return ev;
  }

  // ---- results ----------------------------------------------------------------------------------

  /** Points per player this round (0 for removed players). */
  results() {
    return this.players.map((_, i) => this.points(i));
  }

  /** Player indices, most points first (ties keep join order); removed players left out. */
  ranking() {
    return this.players
      .map((p, i) => ({ p, i, pts: this.points(i) }))
      .filter((x) => !x.p.gone)
      .sort((a, b) => b.pts - a.pts || a.i - b.i)
      .map((x) => x.i);
  }

  /** Who scored the most this round (everyone tied for the top; nobody if no one scored). */
  winners() {
    const pts = this.results();
    const live = this.players.map((_, i) => i).filter((i) => !this.players[i].gone);
    const top = Math.max(0, ...live.map((i) => pts[i]));
    return top > 0 ? live.filter((i) => pts[i] === top) : [];
  }
}

/**
 * A simple computer player (for the /dev bench's autopilot and for tests): chase the loose crown,
 * run from everybody while wearing it, dash at the wearer when close.
 */
export function botInput(sim: CrownSim, i: number): CrownInput {
  const p = sim.players[i];
  const c = sim.crown;
  if (!p || p.gone) return { x: 0, z: 0 };
  let tx = c.x;
  let tz = c.z;
  let dash = false;
  if (c.state === 'held' && c.wearer === i) {
    // Flee from the nearest chaser, steering round the fountain.
    let nx = 0;
    let nz = 0;
    sim.players.forEach((o, j) => {
      if (j === i || o.gone) return;
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const d2 = Math.max(0.5, dx * dx + dz * dz);
      nx += dx / d2;
      nz += dz / d2;
    });
    // Run along the oval round the fountain, the way that leads away.
    const ang = Math.atan2(p.z, p.x);
    const tan = { x: -Math.sin(ang), z: Math.cos(ang) };
    const dir = tan.x * nx + tan.z * nz >= 0 ? 1 : -1;
    tx = p.x + tan.x * dir * 3 + nx * 2;
    tz = p.z + tan.z * dir * 3 + nz * 2;
    const r = Math.hypot(p.x / 9, p.z / 5.4);
    tx += (-p.x / Math.max(0.1, r)) * (r - 1) * 0.6;
    tz += (-p.z / Math.max(0.1, r)) * (r - 1) * 0.6;
  } else if (c.state === 'held') {
    const w = sim.players[c.wearer];
    tx = w.x + w.vx * 0.25;
    tz = w.z + w.vz * 0.25;
    dash = Math.hypot(w.x - p.x, w.z - p.z) < 3.2 && c.immune <= 0;
  } else if (c.state === 'flying') {
    tx = c.tx;
    tz = c.tz;
  }
  const dir = steer(p, tx, tz, i);
  return { x: dir.x, z: dir.z, dash: dash && dir.straight };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Which way to walk from `p` to (tx, tz): straight there, or round the first obstacle in the way
 * (the short way round; `i` breaks the tie when it's dead behind). `straight` is false while going round.
 */
export function steer(p: { x: number; z: number }, tx: number, tz: number, i = 0) {
  const dx = tx - p.x;
  const dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return { x: 0, z: 0, straight: true };
  for (const o of OBSTACLES) {
    const ox = o.x - p.x;
    const oz = o.z - p.z;
    const along = (ox * dx + oz * dz) / d;
    if (along <= 0 || along > d + o.r) continue;
    const side = (ox * dz - oz * dx) / d;
    const clear = o.r + PLAYER_R + 0.15;
    if (Math.abs(side) >= clear) continue;
    const angP = Math.atan2(p.z - o.z, p.x - o.x);
    const diff = wrap(Math.atan2(tz - o.z, tx - o.x) - angP);
    const s = Math.abs(diff) > Math.PI - 0.4 ? (i % 2 ? 1 : -1) : Math.sign(diff) || 1;
    const rx = Math.cos(angP);
    const rz = Math.sin(angP);
    // Round the obstacle, hugging it at a little more than arm's length.
    const err = Math.max(-1.5, Math.min(1.5, (Math.hypot(ox, oz) - clear - 0.3) * 0.8));
    const nx = -rz * s - rx * err;
    const nz = rx * s - rz * err;
    const l = Math.hypot(nx, nz) || 1;
    return { x: nx / l, z: nz / l, straight: false };
  }
  return { x: dx / d, z: dz / d, straight: true };
}

/** "1st", "2nd"… for the phones. */
export function placeText(place: number) {
  return ['', '1st', '2nd', '3rd'][place] ?? `${place}th`;
}

export function howTo(short: boolean): string[] {
  return ['Touch the crown to wear it: 1 point a second', 'Dash into the wearer to knock it off', short ? 'One round of 60 s · last 10 s count double' : 'Two rounds of 60 s · last 10 s count double'];
}
