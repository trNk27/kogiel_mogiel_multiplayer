/**
 * Grosze: the pure rules. No DOM, no three.js. Our take on Mario Party's coin showers.
 *
 * A cobbled old-town market square. Coins rain from the sky: copper grosze (+1), silver złoty (+2)
 * and the odd big gold coin (+5). Each one throws a shadow that grows as it falls, so you can read where
 * it lands; it can be caught just before it touches down, then lies on the cobbles for a few seconds
 * before it's gone. Babcias lean out of the windows round the square and lob flower pots and cast-iron
 * pans at the crowd (a red marker shows where): a hit stuns you for 1.5 s and 30 % of your coins spill
 * round you for anyone to grab. Dash into someone and they drop 3. The rain thickens through the round,
 * and the last 10 s are the Złoty deszcz (golden rain): more coins, more gold, more pots.
 *
 * World units are metres, y is up; the square is centred on the origin, +z towards the camera.
 */
import type { Rng } from '../rng';

export const DT = 1 / 60;

export const ROUND_S = 45;
export const ROUNDS = 2;
export const ROUNDS_SHORT = 1;
/** The last this-many seconds are the golden rain. */
export const GOLDEN_S = 10;

// ---- players -------------------------------------------------------------------------------------
export const WALK = 7;
export const ACCEL = 55;
export const PLAYER_R = 0.7;
export const DEADZONE = 0.14;

export const DASH_TIME = 0.24;
export const DASH_SPEED = 19;
export const DASH_CD = 2.5;
/** A Dash pressed this long before it is ready still counts. */
export const BUFFER = 0.2;
/** A dash bump knocks this many coins out of the victim, who staggers for a moment. */
export const BUMP_DROP = 3;
export const BUMP_STAGGER = 0.5;
export const BUMP_PUSH = 8;
/** After a bump you can't be bumped (or bonked) again for this long. */
export const BUMP_SAFE = 0.7;

/** Hit by a pot or a pan: stunned this long, then safe for INVULN. */
export const STUN = 1.5;
export const INVULN = 1;
/** Share of your coins a hit knocks out of you. */
export const LOSS = 0.3;

// ---- coins ---------------------------------------------------------------------------------------
export type CoinKind = 'copper' | 'silver' | 'gold';
export const COIN_VALUE: Record<CoinKind, number> = { copper: 1, silver: 2, gold: 5 };
/** Size of each coin, which is added to PLAYER_R for pickups. */
export const COIN_R: Record<CoinKind, number> = { copper: 0.3, silver: 0.36, gold: 0.6 };
/** Falling coins drop from DROP_H over FALL_T seconds, and can be caught below CATCH_H. */
export const DROP_H = 13;
export const FALL_T = 1.3;
export const CATCH_H = 1;
/** How long a coin lies on the cobbles; it blinks for the last FADE_T. */
export const COIN_LIFE = 5;
export const FADE_T = 1.2;
/** Spilled coins fly out SPILL_MIN..SPILL_MAX metres over SPILL_T seconds; at most MAX_SPILL pieces. */
export const SPILL_T = 0.5;
export const SPILL_MIN = 1.4;
export const SPILL_MAX = 3.1;
export const MAX_SPILL = 10;
/** No new rain while this many coins are about (spills always happen). */
export const MAX_COINS = 140;

/** Coins per second (before the player-count factor): a slow start, ramping up, then the golden rain. */
export const BASE_RATE = 1.4;
export const PEAK_RATE = 2.8;
export const GOLDEN_RATE = 5.5;

// ---- hazards -------------------------------------------------------------------------------------
export type HazardKind = 'pot' | 'pan';
/** From the throw to the smash. */
export const HAZARD_T = 1.6;
/** Anyone this close to the smash is hit. */
export const HAZARD_R = 1.15;
/** No pots for the first few seconds. */
export const HAZARD_FROM = 4;
/** How often a babcia aims at somebody (else anywhere), and how far off she is. */
export const AIM_CHANCE = 0.6;
export const AIM_JITTER = 0.9;
/** Babcia windows round the square (the scene places them). */
export const WINDOWS = 8;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Half the width (x) and depth (z) of the square's playing area. */
export function arenaFor(n: number): { hw: number; hd: number } {
  return n <= 4 ? { hw: 10, hd: 6.5 } : { hw: 12, hd: 7.5 };
}

/** More players, more coins. */
export const coinFactor = (n: number) => 0.75 + 0.15 * clamp(n, 1, 8);
export const hazardFactor = (n: number) => 0.7 + 0.1 * clamp(n, 1, 8);

/** Coins per second at time `t` of a round `length` long, for `n` players. */
export function coinRate(t: number, length: number, n: number) {
  const g = length - GOLDEN_S;
  if (t >= g) return GOLDEN_RATE * coinFactor(n);
  const u = clamp(t / g, 0, 1);
  return (BASE_RATE + (PEAK_RATE - BASE_RATE) * u) * coinFactor(n);
}

/** Pots and pans per second at time `t`. */
export function hazardRate(t: number, length: number, n: number) {
  if (t < HAZARD_FROM) return 0;
  const g = length - GOLDEN_S;
  if (t >= g) return 1.0 * hazardFactor(n);
  const u = clamp((t - HAZARD_FROM) / Math.max(1e-6, g - HAZARD_FROM), 0, 1);
  return (0.3 + 0.3 * u) * hazardFactor(n);
}

/** Which coin falls, from a random number `r` in 0..1. Gold is rare, except in the golden rain. */
export function coinKind(golden: boolean, r: number): CoinKind {
  if (golden) return r < 0.18 ? 'gold' : r < 0.6 ? 'silver' : 'copper';
  return r < 0.04 ? 'gold' : r < 0.26 ? 'silver' : 'copper';
}

export const kindOf = (value: number): CoinKind => (value >= 5 ? 'gold' : value >= 2 ? 'silver' : 'copper');

/** Coins a pot or pan knocks out of someone holding `coins`: 30 %, rounded up (at least 1 if you have any). */
export function lossFor(coins: number) {
  const c = Math.max(0, Math.floor(coins));
  if (c <= 0) return 0;
  return Math.min(c, Math.ceil(c * LOSS - 1e-9));
}

/**
 * How `n` coins spill: as copper grosze, switching to bigger coins only when there would be more than
 * MAX_SPILL pieces. The pieces always add up to `n`.
 */
export function spillPieces(n: number): number[] {
  const total = Math.max(0, Math.floor(n));
  const make = (g: number, sv: number, c: number) => [...Array(c).fill(1), ...Array(sv).fill(2), ...Array(g).fill(5)] as number[];
  if (total <= MAX_SPILL) return make(0, 0, total);
  // As few golds as possible; then as few silvers as fit the rest in the slots left.
  for (let g = 0; g < MAX_SPILL; g++) {
    const r = total - 5 * g;
    if (r < 0) break;
    const sv = Math.max(0, r - (MAX_SPILL - g));
    if (2 * sv <= r) return make(g, sv, r - 2 * sv);
  }
  // A fortune: gold all the way, and the change.
  const g = Math.floor(total / 5);
  const r = total - 5 * g;
  return make(g, Math.floor(r / 2), r % 2);
}

export interface CoinsInput {
  /** Joystick, -1..1 each; +x right, +z towards the viewer. */
  x: number;
  z: number;
  /** A press of Dash since the last step. */
  dash?: boolean;
}

export interface CoinsPlayer {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing (unit vector). */
  fx: number;
  fz: number;
  /** Coins held this round. */
  coins: number;
  /** Seconds left stunned by a pot, staggered by a bump, and safe from both. */
  stun: number;
  stagger: number;
  inv: number;
  /** Seconds of dash left, and its direction. */
  dash: number;
  dx: number;
  dz: number;
  dashCd: number;
  dashBuf: number;
  /** Who this dash already bumped. */
  hit: number[];
  gone: boolean;
  /** How far the stick is pushed (0..1), for walking animations. */
  speed: number;
  /** This round: coins picked up, times bonked by a pot. */
  picked: number;
  bonks: number;
}

export interface Coin {
  id: number;
  kind: CoinKind;
  value: number;
  /** Where it lands (or lies). */
  x: number;
  z: number;
  /** fall: coming down from the sky; pop: flying out of a spill from (sx, sz); ground: lying there. */
  state: 'fall' | 'pop' | 'ground';
  /** Seconds in this state. */
  t: number;
  sx: number;
  sz: number;
  /** True for the golden rain's coins (drawn bigger). */
  golden: boolean;
}

export interface Hazard {
  id: number;
  kind: HazardKind;
  /** The window it's thrown from (0..WINDOWS-1). */
  win: number;
  tx: number;
  tz: number;
  t: number;
  /** The player it was aimed at, or -1. */
  aim: number;
}

export type CoinsEvent =
  | { t: 'spawn'; id: number; kind: CoinKind }
  | { t: 'land'; id: number; kind: CoinKind; x: number; z: number }
  | { t: 'pick'; p: number; id: number; kind: CoinKind; value: number; x: number; z: number; caught: boolean }
  | { t: 'expire'; id: number }
  | { t: 'throw'; id: number; kind: HazardKind; win: number; tx: number; tz: number }
  | { t: 'smash'; id: number; kind: HazardKind; x: number; z: number; hits: number[] }
  | { t: 'hit'; p: number; lost: number; by: HazardKind }
  | { t: 'recover'; p: number }
  | { t: 'dash'; p: number }
  | { t: 'bump'; by: number; p: number; lost: number }
  | { t: 'spill'; p: number; ids: number[] }
  | { t: 'golden' }
  | { t: 'over' };

/** Height of a falling coin `t` seconds after it was dropped (it speeds up as it falls). */
export function fallHeight(t: number) {
  const u = clamp(t / FALL_T, 0, 1);
  return DROP_H * (1 - u * u);
}

/** Height of a coin `t` seconds into a spill hop. */
export function popHeight(t: number) {
  const u = clamp(t / SPILL_T, 0, 1);
  return 0.6 * (1 - u) + 1.7 * 4 * u * (1 - u);
}

export interface CoinsOptions {
  rng?: Rng;
  length?: number;
  /** Override the play area (tests). */
  hw?: number;
  hd?: number;
}

export class CoinsSim {
  readonly n: number;
  readonly length: number;
  readonly hw: number;
  readonly hd: number;
  readonly players: CoinsPlayer[] = [];
  coins: Coin[] = [];
  hazards: Hazard[] = [];
  time = 0;
  golden = false;
  done = false;
  /** Fractional coins / hazards owed by the spawn schedule. */
  coinAcc = 0;
  hazardAcc = 0;
  private nextId = 1;
  private events: CoinsEvent[] = [];
  private readonly rng: Rng;

  constructor(n: number, opts: CoinsOptions = {}) {
    this.n = n;
    this.rng = opts.rng ?? Math.random;
    this.length = opts.length ?? ROUND_S;
    const a = arenaFor(n);
    this.hw = opts.hw ?? a.hw;
    this.hd = opts.hd ?? a.hd;
    // Players start in a ring round the middle of the square, facing the camera.
    for (let i = 0; i < n; i++) {
      const ang = n === 1 ? Math.PI / 2 : (i / n) * Math.PI * 2 + Math.PI / 2;
      const r = n === 1 ? 0 : Math.min(this.hd * 0.55, 1.6 + n * 0.35);
      this.players.push({
        x: Math.cos(ang) * r * 1.35,
        z: Math.sin(ang) * r * 0.75,
        vx: 0,
        vz: 0,
        fx: 0,
        fz: 1,
        coins: 0,
        stun: 0,
        stagger: 0,
        inv: 0,
        dash: 0,
        dx: 0,
        dz: 1,
        dashCd: 0,
        dashBuf: 0,
        hit: [],
        gone: false,
        speed: 0,
        picked: 0,
        bonks: 0,
      });
    }
  }

  get left() {
    return Math.max(0, this.length - this.time);
  }

  /** Players still in the game. */
  get live() {
    return this.players.map((_, i) => i).filter((i) => !this.players[i].gone);
  }

  /** Height of a coin above the cobbles right now. */
  coinY(c: Coin) {
    return c.state === 'fall' ? fallHeight(c.t) : c.state === 'pop' ? popHeight(c.t) : 0;
  }

  /** A player leaves for good: their coins go with them. */
  remove(i: number) {
    const p = this.players[i];
    if (!p || p.gone) return;
    p.gone = true;
    p.coins = 0;
    p.dash = 0;
    p.vx = p.vz = 0;
  }

  /** Coins per player (removed players score 0). */
  scores() {
    return this.players.map((p) => (p.gone ? 0 : p.coins));
  }

  /** Live players, most coins first (ties keep join order). */
  ranking() {
    return this.live.sort((a, b) => this.players[b].coins - this.players[a].coins || a - b);
  }

  /** Everyone sharing the most coins (nobody if nobody has any). */
  winners() {
    const live = this.live;
    const best = Math.max(0, ...live.map((i) => this.players[i].coins));
    return best > 0 ? live.filter((i) => this.players[i].coins === best) : [];
  }

  // ---- the step ----------------------------------------------------------------------------------

  step(inputs: readonly (CoinsInput | undefined)[]): CoinsEvent[] {
    const ev: CoinsEvent[] = (this.events = []);
    if (this.done) return ev;
    this.time += DT;
    if (!this.golden && this.time >= this.length - GOLDEN_S) {
      this.golden = true;
      ev.push({ t: 'golden' });
    }
    this.schedule();
    for (let i = 0; i < this.n; i++) this.control(i, inputs[i]);
    this.collide();
    this.tickCoins();
    this.pickups();
    this.tickHazards();
    if (this.time >= this.length - 1e-9) {
      this.done = true;
      ev.push({ t: 'over' });
    }
    return ev;
  }

  /** The spawn schedule: coins and hazards owed by the rates so far. */
  private schedule() {
    const t = this.time;
    this.coinAcc += coinRate(t, this.length, this.n) * DT;
    while (this.coinAcc >= 1) {
      this.coinAcc -= 1;
      if (this.coins.length < MAX_COINS) this.dropCoin();
    }
    this.hazardAcc += hazardRate(t, this.length, this.n) * DT;
    while (this.hazardAcc >= 1) {
      this.hazardAcc -= 1;
      this.throwHazard();
    }
  }

  private randomSpot(margin: number) {
    return {
      x: (this.rng() * 2 - 1) * (this.hw - margin),
      z: (this.rng() * 2 - 1) * (this.hd - margin),
    };
  }

  /** Drop a coin from the sky (exported for tests through `addCoin`). */
  private dropCoin() {
    const kind = coinKind(this.golden, this.rng());
    const s = this.randomSpot(0.7);
    this.addCoin(kind, s.x, s.z, 'fall');
  }

  /** Put a coin in play: falling at (x, z), lying there, or spilling there from (sx, sz). */
  addCoin(kind: CoinKind, x: number, z: number, state: Coin['state'] = 'ground', sx = x, sz = z): Coin {
    const c: Coin = { id: this.nextId++, kind, value: COIN_VALUE[kind], x, z, state, t: 0, sx, sz, golden: this.golden };
    this.coins.push(c);
    if (state === 'fall') this.events.push({ t: 'spawn', id: c.id, kind });
    return c;
  }

  private throwHazard() {
    const kind: HazardKind = this.rng() < 0.35 ? 'pan' : 'pot';
    const win = Math.floor(this.rng() * WINDOWS) % WINDOWS;
    const targets = this.live.filter((i) => this.players[i].stun <= 0);
    let tx: number;
    let tz: number;
    let aim = -1;
    if (targets.length && this.rng() < AIM_CHANCE) {
      aim = targets[Math.floor(this.rng() * targets.length) % targets.length];
      const p = this.players[aim];
      const a = this.rng() * Math.PI * 2;
      const d = this.rng() * AIM_JITTER;
      tx = p.x + Math.cos(a) * d;
      tz = p.z + Math.sin(a) * d;
    } else {
      const s = this.randomSpot(0.6);
      tx = s.x;
      tz = s.z;
    }
    tx = clamp(tx, -this.hw + 0.4, this.hw - 0.4);
    tz = clamp(tz, -this.hd + 0.4, this.hd - 0.4);
    this.addHazard(kind, tx, tz, win, aim);
  }

  /** Throw a pot or pan at (tx, tz) (public for tests). */
  addHazard(kind: HazardKind, tx: number, tz: number, win = 0, aim = -1): Hazard {
    const h: Hazard = { id: this.nextId++, kind, win, tx, tz, t: 0, aim };
    this.hazards.push(h);
    this.events.push({ t: 'throw', id: h.id, kind, win, tx, tz });
    return h;
  }

  // ---- players -----------------------------------------------------------------------------------

  private control(i: number, inp: CoinsInput = { x: 0, z: 0 }) {
    const p = this.players[i];
    if (p.gone) return;
    p.dashCd = Math.max(0, p.dashCd - DT);
    p.dashBuf = Math.max(0, p.dashBuf - DT);
    p.inv = Math.max(0, p.inv - DT);
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
    if (p.stun > 0 || p.stagger > 0) {
      if (p.stun > 0) {
        p.stun = Math.max(0, p.stun - DT);
        if (p.stun === 0) {
          p.inv = INVULN;
          this.events.push({ t: 'recover', p: i });
        }
      }
      if (p.stagger > 0) p.stagger = Math.max(0, p.stagger - DT);
      const k = Math.exp(-6 * DT);
      p.vx *= k;
      p.vz *= k;
      p.dashBuf = 0;
    } else if (p.dash > 0) {
      p.dash = Math.max(0, p.dash - DT);
      p.vx = p.dx * DASH_SPEED;
      p.vz = p.dz * DASH_SPEED;
      this.dashHits(i);
      if (p.dash === 0) {
        p.vx *= 0.3;
        p.vz *= 0.3;
      }
    } else {
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
      if (p.dashBuf > 0 && p.dashCd <= 0) this.startDash(i);
    }
    p.x += p.vx * DT;
    p.z += p.vz * DT;
    const mxp = this.hw - PLAYER_R * 0.6;
    const mzp = this.hd - PLAYER_R * 0.6;
    if (Math.abs(p.x) > mxp) {
      p.x = clamp(p.x, -mxp, mxp);
      p.vx = 0;
    }
    if (Math.abs(p.z) > mzp) {
      p.z = clamp(p.z, -mzp, mzp);
      p.vz = 0;
    }
  }

  private startDash(i: number) {
    const p = this.players[i];
    p.dash = DASH_TIME;
    p.dx = p.fx;
    p.dz = p.fz;
    p.hit = [];
    p.dashCd = DASH_CD;
    p.dashBuf = 0;
    p.vx = p.dx * DASH_SPEED;
    p.vz = p.dz * DASH_SPEED;
    this.events.push({ t: 'dash', p: i });
  }

  /** A dash bowls into anyone it touches: they drop BUMP_DROP coins and stagger. */
  private dashHits(i: number) {
    const p = this.players[i];
    for (let j = 0; j < this.n; j++) {
      const o = this.players[j];
      if (j === i || o.gone || p.hit.includes(j)) continue;
      if (Math.hypot(o.x - p.x, o.z - p.z) >= PLAYER_R * 2 + 0.2) continue;
      p.hit.push(j);
      if (o.stun > 0 || o.stagger > 0 || o.inv > 0) continue;
      const lost = Math.min(BUMP_DROP, o.coins);
      o.coins -= lost;
      o.stagger = BUMP_STAGGER;
      o.inv = Math.max(o.inv, BUMP_STAGGER + BUMP_SAFE);
      o.dash = 0;
      o.vx = p.dx * BUMP_PUSH;
      o.vz = p.dz * BUMP_PUSH;
      this.events.push({ t: 'bump', by: i, p: j, lost });
      this.spill(j, lost);
      // The dasher bounces off.
      p.dash = 0;
      p.vx = -p.dx * 2;
      p.vz = -p.dz * 2;
      return;
    }
  }

  /** `n` coins fly out of player `i` in a burst, landing round them. */
  spill(i: number, n: number) {
    const p = this.players[i];
    if (!p || n <= 0) return;
    const pieces = spillPieces(n);
    const ids: number[] = [];
    const off = this.rng() * Math.PI * 2;
    pieces.forEach((v, k) => {
      const a = off + (k / pieces.length) * Math.PI * 2 + (this.rng() - 0.5) * 0.5;
      const d = SPILL_MIN + this.rng() * (SPILL_MAX - SPILL_MIN);
      const x = clamp(p.x + Math.cos(a) * d, -this.hw + 0.4, this.hw - 0.4);
      const z = clamp(p.z + Math.sin(a) * d, -this.hd + 0.4, this.hd - 0.4);
      ids.push(this.addCoin(kindOf(v), x, z, 'pop', p.x, p.z).id);
    });
    this.events.push({ t: 'spill', p: i, ids });
  }

  /** Soft circles: overlapping players are pushed apart (a dashing player doesn't give way). */
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
        const wa = a.dash > 0 && b.dash <= 0 ? 0 : b.dash > 0 && a.dash <= 0 ? 1 : 0.5;
        a.x -= nx * push * wa;
        a.z -= nz * push * wa;
        b.x += nx * push * (1 - wa);
        b.z += nz * push * (1 - wa);
      }
    }
  }

  // ---- coins -------------------------------------------------------------------------------------

  private tickCoins() {
    for (let k = this.coins.length - 1; k >= 0; k--) {
      const c = this.coins[k];
      c.t += DT;
      if (c.state === 'fall' && c.t >= FALL_T) {
        c.state = 'ground';
        c.t = 0;
        this.events.push({ t: 'land', id: c.id, kind: c.kind, x: c.x, z: c.z });
      } else if (c.state === 'pop' && c.t >= SPILL_T) {
        c.state = 'ground';
        c.t = 0;
        this.events.push({ t: 'land', id: c.id, kind: c.kind, x: c.x, z: c.z });
      } else if (c.state === 'ground' && c.t >= COIN_LIFE) {
        this.coins.splice(k, 1);
        this.events.push({ t: 'expire', id: c.id });
      }
    }
  }

  /** Can player `i` pick things up right now? */
  canPick(i: number) {
    const p = this.players[i];
    return !!p && !p.gone && p.stun <= 0 && p.stagger <= 0;
  }

  /** Every coin within reach goes to the nearest player who can take it. */
  private pickups() {
    for (let k = this.coins.length - 1; k >= 0; k--) {
      const c = this.coins[k];
      if (c.state === 'pop') continue;
      if (c.state === 'fall' && fallHeight(c.t) > CATCH_H) continue;
      const reach = PLAYER_R + COIN_R[c.kind];
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < this.n; i++) {
        if (!this.canPick(i)) continue;
        const p = this.players[i];
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < reach && d < bestD) {
          best = i;
          bestD = d;
        }
      }
      if (best < 0) continue;
      const p = this.players[best];
      p.coins += c.value;
      p.picked += c.value;
      this.coins.splice(k, 1);
      this.events.push({ t: 'pick', p: best, id: c.id, kind: c.kind, value: c.value, x: c.x, z: c.z, caught: c.state === 'fall' });
    }
  }

  // ---- hazards -----------------------------------------------------------------------------------

  private tickHazards() {
    for (let k = this.hazards.length - 1; k >= 0; k--) {
      const h = this.hazards[k];
      h.t += DT;
      if (h.t < HAZARD_T) continue;
      this.hazards.splice(k, 1);
      this.smash(h);
    }
  }

  private smash(h: Hazard) {
    const hits: number[] = [];
    for (let i = 0; i < this.n; i++) {
      const p = this.players[i];
      if (p.gone) continue;
      if (Math.hypot(p.x - h.tx, p.z - h.tz) >= HAZARD_R) continue;
      if (p.stun > 0 || p.inv > 0) continue;
      hits.push(i);
    }
    this.events.push({ t: 'smash', id: h.id, kind: h.kind, x: h.tx, z: h.tz, hits });
    for (const i of hits) this.bonk(i, h.kind);
  }

  /** Player `i` is hit: stunned, and 30 % of their coins spill. */
  bonk(i: number, by: HazardKind = 'pot') {
    const p = this.players[i];
    if (!p || p.gone) return;
    const lost = lossFor(p.coins);
    p.coins -= lost;
    p.stun = STUN;
    p.stagger = 0;
    p.dash = 0;
    p.vx = p.vz = 0;
    p.bonks++;
    this.events.push({ t: 'hit', p: i, lost, by });
    this.spill(i, lost);
  }
}

export function placeText(n: number) {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

export function howTo(short: boolean): string[] {
  return [
    'Catch coins: copper 1 · silver 2 · gold 5',
    'Dodge the babcias’ pots · Dash to bump',
    short ? 'One round of 45 s · most coins wins' : 'Two rounds of 45 s · coins add up',
  ];
}
