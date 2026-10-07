/**
 * Grzybki ("little mushrooms"): pure rules and simulation. No DOM, no three.js.
 *
 * World units are metres, x to the right, z towards the viewer, y up. The arena is a round wooden
 * platform (a tree stump) with a ring of giant mushroom caps around it. Every call, one colour is
 * announced; when the timer runs out the platform and every other mushroom sink, and anyone not
 * standing on a cap of the called colour falls into the pond.
 */
import type { Rng } from '../rng';

export const DT = 1 / 60;

/** Rounds in a full game and in a tournament. */
export const MUSH_ROUNDS = 3;
export const MUSH_ROUNDS_SHORT = 1;
/** The last player standing gets this many points on top. */
export const WIN_BONUS = 2;

// ---- movement ------------------------------------------------------------------

export const WALK = 5.5;
/** How quickly the walking velocity follows the stick (per second): a little inertia. */
export const WALK_RESPONSE = 11;
/** Players are soft circles of this radius. */
export const PLAYER_R = 0.55;
/** How hard overlapping players push each other apart (per second). */
export const PUSH = 20;
export const SHOVE_COOL = 1.2;
export const SHOVE_DASH_S = 0.22;
export const DASH_SPEED = 12;
/** Speed given to a player who is shoved, and how fast it dies away (per second). */
export const KNOCK = 10.5;
export const KNOCK_DECAY = 6.5;
/** Walking can take your centre this far past a cap's rim (you hang over the edge). */
export const EDGE_LIP = 0.22;
/** Pushed further than that past the lip, you fall in at once. */
export const FALL_MARGIN = 0.38;

// ---- timing -------------------------------------------------------------------

/** Players can already walk about during this countdown. */
export const READY_S = 3.0;
/** Pause between the mushrooms coming back up and the next call. */
export const GAP_S = 1.5;
export const SINK_S = 0.9;
/** How long things stay sunk (the fallen splash about and the survivors cheer). */
export const HOLD_S = 1.5;
export const RISE_S = 1.1;
/** The round-over banner stays up this long. */
export const OVER_S = 5.5;
/** A round never lasts longer than this many calls. */
export const MAX_CALLS = 30;

export const CALL_FIRST_S = 4.5;
export const CALL_MIN_S = 1.6;
const CALL_DECAY = 0.88;
/** Swap calls (the mushrooms change colour as the colour is called) get this much extra. */
export const SWAP_BONUS_S = 0.45;
/** Reaction plus acceleration time we never count on, when checking a target can be reached. */
export const REACT_S = 0.55;

/** How long the sign is up: the time allowed for call number `n` (1-based). */
export function callTimeFor(n: number): number {
  return Math.max(CALL_MIN_S, CALL_FIRST_S * Math.pow(CALL_DECAY, Math.max(0, n - 1)));
}

/** Ring rotation speed (rad/s, before the random direction) for call number `n`. */
export function spinFor(n: number): number {
  if (n <= 2) return 0;
  if (n <= 4) return 0.12;
  if (n <= 6) return 0.2;
  return 0.3;
}

// ---- the mushrooms ---------------------------------------------------------------

export interface Species {
  id: string;
  /** The word on the TV banner. */
  word: string;
  mushroom: string;
  hex: string;
  /** Colour of the dots on the cap. */
  spot: string;
}

/** Clearly different on a TV, and none of them water, grass or wood. */
export const SPECIES: readonly Species[] = [
  { id: 'red', word: 'RED', mushroom: 'Fly agaric', hex: '#dc2a2a', spot: '#fff6e6' },
  { id: 'yellow', word: 'YELLOW', mushroom: 'Chanterelle', hex: '#f5e03a', spot: '#fff9bd' },
  { id: 'blue', word: 'BLUE', mushroom: 'Indigo milk cap', hex: '#2f78ea', spot: '#a3c8ff' },
  { id: 'purple', word: 'PURPLE', mushroom: 'Amethyst deceiver', hex: '#9446cf', spot: '#dcb4f8' },
  { id: 'green', word: 'GREEN', mushroom: 'Green brittlegill', hex: '#35b856', spot: '#b0eeb8' },
  { id: 'brown', word: 'BROWN', mushroom: 'Porcini', hex: '#a46a3a', spot: '#e0bc8c' },
  { id: 'pink', word: 'PINK', mushroom: 'Pink bonnet', hex: '#ff7db7', spot: '#ffd3e6' },
  { id: 'white', word: 'WHITE', mushroom: 'Button mushroom', hex: '#f3eee3', spot: '#cdb99a' },
];

/** How many mushrooms ring the platform for this many players. */
export function capsFor(players: number): number {
  return players <= 4 ? 6 : players <= 6 ? 7 : 8;
}

export const RING_R = 4.6;
/** Height of the platform and the cap tops above the water. */
export const DECK_Y = 0.9;
export const POND_R = 12.2;

export interface Layout {
  /** Number of caps. */
  n: number;
  /** Distance of the cap centres from the middle. */
  ringR: number;
  /** Radius the cap is drawn with. */
  capR: number;
  /** Radius that counts as standing on it (a little more, so neighbours overlap). */
  capHit: number;
  /** Radius of the central platform. */
  platR: number;
}

export function makeLayout(n: number): Layout {
  const s = Math.sin(Math.PI / n);
  const capR = 0.985 * RING_R * s;
  const capHit = capR + 0.12;
  // The platform reaches out to where two neighbouring caps cross, so there are no holes.
  const gap = RING_R * Math.cos(Math.PI / n) - Math.sqrt(Math.max(0, capHit * capHit - RING_R * s * (RING_R * s)));
  return { n, ringR: RING_R, capR, capHit, platR: Math.max(2.4, gap + 0.15) };
}

export function capAngle(L: Layout, ring: number, i: number) {
  return ring + (i / L.n) * Math.PI * 2;
}

export function capPos(L: Layout, ring: number, i: number): { x: number; z: number } {
  const a = capAngle(L, ring, i);
  return { x: Math.cos(a) * L.ringR, z: Math.sin(a) * L.ringR };
}

export type Support = { kind: 'cap'; idx: number } | { kind: 'platform' } | { kind: 'water' };

/** What a player with their centre at (x, z) is standing on. Caps win over the platform. */
export function supportAt(L: Layout, ring: number, x: number, z: number): Support {
  let best = -1;
  let bestK = Infinity;
  for (let i = 0; i < L.n; i++) {
    const c = capPos(L, ring, i);
    const d = Math.hypot(x - c.x, z - c.z);
    if (d <= L.capHit && d < bestK) {
      bestK = d;
      best = i;
    }
  }
  if (best >= 0) return { kind: 'cap', idx: best };
  if (Math.hypot(x, z) <= L.platR) return { kind: 'platform' };
  return { kind: 'water' };
}

/** Does standing here at the moment of the sink save you? `safe` are the cap indices of the called colour. */
export function survivesSink(L: Layout, ring: number, x: number, z: number, safe: readonly number[]): boolean {
  const s = supportAt(L, ring, x, z);
  return s.kind === 'cap' && safe.includes(s.idx);
}

/** The distance a point is outside the walkable deck (0 when on it), and the way back in. */
export function outsideDeck(
  L: Layout,
  ring: number,
  x: number,
  z: number,
  caps: readonly boolean[],
  platform: boolean,
  lip = EDGE_LIP,
): { o: number; nx: number; nz: number } {
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  const test = (cx: number, cz: number, r: number) => {
    const dx = x - cx;
    const dz = z - cz;
    const d = Math.hypot(dx, dz);
    const o = d - (r + lip);
    if (o < best) {
      best = o;
      // Unit vector from the point back towards the disc's centre.
      bx = d > 1e-6 ? -dx / d : 0;
      bz = d > 1e-6 ? -dz / d : 0;
    }
  };
  if (platform) test(0, 0, L.platR);
  for (let i = 0; i < L.n; i++) {
    if (!caps[i]) continue;
    const c = capPos(L, ring, i);
    test(c.x, c.z, L.capHit);
  }
  return { o: Math.max(0, best), nx: bx, nz: bz };
}

/** How far a player can run in `time` seconds, after reaction and getting up to speed. */
export function walkReach(time: number): number {
  return Math.max(0, (time - REACT_S) * WALK);
}

/** From the platform centre, can a player get to a cap's centre within `time`? (Same for every cap.) */
export function centreReachable(L: Layout, time: number): boolean {
  return L.ringR <= walkReach(time);
}

/** Can a player at (x, z) get onto cap `i` in `time`, allowing for the ring turning at `omega` rad/s? */
export function capReachableFrom(L: Layout, ring: number, omega: number, i: number, x: number, z: number, time: number): boolean {
  const c = capPos(L, ring, i);
  const d = Math.hypot(c.x - x, c.z - z);
  const slack = Math.abs(omega) * L.ringR * time * 0.5;
  return d - L.capR * 0.7 + slack <= walkReach(time);
}

// ---- scoring --------------------------------------------------------------------

export interface RoundResult {
  /** Points per player index (0 for players not in the round). */
  points: number[];
  /** The single last player standing, or null (a tie). */
  winner: number | null;
}

/**
 * `fellAt[i]` is when player i fell in (ms, any clock), or null if still standing. `present[i]` is
 * false for players who left the game. Each player scores how many players fell in before them
 * (strictly earlier, so falling in the same moment ties); a sole survivor also gets the win bonus.
 */
export function roundPoints(fellAt: readonly (number | null)[], present: readonly boolean[]): RoundResult {
  const idx = fellAt.map((_, i) => i).filter((i) => present[i]);
  const points = fellAt.map(() => 0);
  for (const i of idx) {
    const mine = fellAt[i];
    let n = 0;
    for (const j of idx) {
      if (j === i) continue;
      const theirs = fellAt[j];
      if (theirs === null) continue;
      if (mine === null || theirs < mine) n++;
    }
    points[i] = n;
  }
  const standing = idx.filter((i) => fellAt[i] === null);
  const winner = standing.length === 1 ? standing[0] : null;
  if (winner !== null) points[winner] += WIN_BONUS;
  return { points, winner };
}

// ---- the simulation ------------------------------------------------------------

export type Phase = 'ready' | 'gap' | 'call' | 'sink' | 'rise' | 'over';

export interface MPlayer {
  present: boolean;
  alive: boolean;
  x: number;
  z: number;
  /** Walking velocity (follows the stick). */
  vx: number;
  vz: number;
  /** Knock-back velocity (from shoves). */
  kx: number;
  kz: number;
  /** Direction the pierogi faces (radians, atan2(x, z)). */
  face: number;
  inX: number;
  inZ: number;
  /** Dash time left, and its direction. */
  dash: number;
  dashX: number;
  dashZ: number;
  hit: number[];
  /** Seconds until the next shove is ready. */
  cool: number;
  shoves: number;
  fellAt: number | null;
  /** Seconds since falling in. */
  fallT: number;
  /** Where the fallen player swims to, and whether they've got there. */
  bankX: number;
  bankZ: number;
  path: { x: number; z: number }[];
  swimming: boolean;
  onBank: boolean;
  /** What this player was standing on when the last tick began. */
  on: Support;
}

export type MEvent =
  | { t: 'call'; n: number; colour: number; time: number; swap: boolean; twin: number | null; target: number }
  | { t: 'recolour'; cap: number; to: number }
  | { t: 'sink'; fell: number[]; safe: number[] }
  | { t: 'fall'; p: number; x: number; z: number; why: 'sink' | 'edge' }
  | { t: 'shove'; p: number }
  | { t: 'hit'; a: number; b: number; x: number; z: number }
  | { t: 'rise' }
  | { t: 'over'; winner: number | null; /** The last splash happened a moment ago, so the banner can wait. */ fresh: boolean };

const approach = (v: number, to: number, step: number) => (v < to ? Math.min(to, v + step) : Math.max(to, v - step));

export class MushroomSim {
  readonly players: MPlayer[];
  readonly L: Layout;
  phase: Phase = 'ready';
  phaseT = 0;
  time = 0;
  ring = 0;
  omega = 0;
  omegaTo = 0;
  /** Colour (species index) each cap has right now, and the underlying colours twins revert to. */
  cur: number[];
  base: number[];
  callNo = 0;
  callTime = 0;
  callLeft = 0;
  targetCap = -1;
  targetColour = -1;
  twinCap: number | null = null;
  safe: number[] = [];
  /** 0 = up, 1 = sunk. */
  capDown: number[];
  platDown = 0;
  /** The players who fell in at the last sink. */
  lastFell: number[] = [];
  ended = false;
  winner: number | null = null;
  private lastSwap = false;
  private prevTarget = -1;
  private bankCount: Record<number, number> = { 1: 0, [-1]: 0 };

  constructor(
    count: number,
    private rng: Rng,
    present: boolean[] = Array.from({ length: count }, () => true),
    startPositions?: { x: number; z: number }[],
    capCount?: number,
  ) {
    const living = present.filter(Boolean).length;
    this.L = makeLayout(capCount ?? capsFor(Math.max(2, living)));
    const n = this.L.n;
    // Shuffle which species sits where.
    const order = SPECIES.slice(0, n).map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.base = order;
    this.cur = order.slice();
    this.capDown = order.map(() => 0);
    this.players = Array.from({ length: count }, (_, i) => {
      // Start on the platform, spread on a ring round the middle.
      const a = (i / Math.max(1, living)) * Math.PI * 2 + 0.4;
      const r = living > 1 ? Math.min(this.L.platR - 0.9, 0.55 + living * 0.2) : 0;
      const sp = startPositions?.[i];
      return {
        present: present[i],
        alive: present[i],
        x: sp ? sp.x : Math.cos(a) * r,
        z: sp ? sp.z : Math.sin(a) * r,
        vx: 0,
        vz: 0,
        kx: 0,
        kz: 0,
        face: 0,
        inX: 0,
        inZ: 0,
        dash: 0,
        dashX: 0,
        dashZ: 1,
        hit: [],
        cool: 0,
        shoves: 0,
        fellAt: null,
        fallT: 0,
        bankX: 0,
        bankZ: 0,
        path: [],
        swimming: false,
        onBank: false,
        on: { kind: 'platform' },
      };
    });
  }

  alive(): number[] {
    return this.players.map((_, i) => i).filter((i) => this.players[i].alive);
  }

  setInput(i: number, x: number, y: number) {
    const p = this.players[i];
    if (!p) return;
    const len = Math.hypot(x, y);
    const k = len > 1 ? 1 / len : 1;
    p.inX = x * k;
    p.inZ = y * k;
  }

  /** Ask for a shove (it happens on the next tick if it's ready and allowed). */
  queueShove(i: number) {
    const p = this.players[i];
    if (p) p.shoves++;
  }

  /** Remove a player from the arena (kicked from the party). */
  remove(i: number): MEvent[] {
    const p = this.players[i];
    if (!p || !p.present) return [];
    p.present = false;
    p.alive = false;
    p.fellAt = null;
    return this.checkEnd();
  }

  private shoveAllowed() {
    return this.phase === 'gap' || this.phase === 'call';
  }

  /** The caps players may walk on right now. */
  private walkCaps(): boolean[] {
    if (this.phase === 'sink' || this.phase === 'rise') return this.cur.map((_, i) => this.safe.includes(i));
    return this.cur.map(() => true);
  }

  private walkPlatform() {
    return !(this.phase === 'sink' || this.phase === 'rise');
  }

  step(): MEvent[] {
    const ev: MEvent[] = [];
    this.time += DT;
    this.phaseT += DT;

    // The ring turns, carrying whoever stands on a cap.
    this.omega = approach(this.omega, this.omegaTo, 0.4 * DT);
    const dth = this.omega * DT;
    if (dth !== 0) {
      this.ring += dth;
      const c = Math.cos(dth);
      const s = Math.sin(dth);
      for (const p of this.players) {
        if (!p.alive || p.on.kind !== 'cap') continue;
        const x = p.x * c - p.z * s;
        const z = p.x * s + p.z * c;
        p.x = x;
        p.z = z;
      }
    }

    this.movePlayers(ev);
    this.updateSwimmers();
    this.updateDown();

    switch (this.phase) {
      case 'ready':
        if (this.phaseT >= READY_S) this.go('gap');
        break;
      case 'gap':
        if (this.phaseT >= (this.callNo === 0 ? 0.9 : GAP_S)) this.startCall(ev);
        break;
      case 'call':
        this.callLeft -= DT;
        if (this.callLeft <= 0) this.resolve(ev);
        break;
      case 'sink':
        if (this.phaseT >= SINK_S + HOLD_S) {
          if (this.ended) {
            this.go('over');
            ev.push({ t: 'over', winner: this.winner, fresh: false });
          } else {
            this.go('rise');
            ev.push({ t: 'rise' });
          }
        }
        break;
      case 'rise':
        if (this.phaseT >= RISE_S) this.go('gap');
        break;
      case 'over':
        break;
    }
    return ev;
  }

  private go(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  // ---- movement ------------------------------------------------------------------

  private movePlayers(ev: MEvent[]) {
    const L = this.L;
    const acting = this.phase !== 'over';
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive) continue;
      p.on = supportAt(L, this.ring, p.x, p.z);
      p.cool = Math.max(0, p.cool - DT);
      // Shove.
      if (p.shoves > 0) {
        if (p.cool <= 0 && p.dash <= 0 && this.shoveAllowed()) {
          const len = Math.hypot(p.inX, p.inZ);
          if (len > 0.2) {
            p.dashX = p.inX / len;
            p.dashZ = p.inZ / len;
          } else {
            p.dashX = Math.sin(p.face);
            p.dashZ = Math.cos(p.face);
          }
          p.dash = SHOVE_DASH_S;
          p.hit = [];
          p.cool = SHOVE_COOL;
          ev.push({ t: 'shove', p: i });
        }
        p.shoves = 0;
      }
      // Walking velocity follows the stick (or the dash).
      if (p.dash > 0) {
        p.dash -= DT;
        p.vx = p.dashX * DASH_SPEED;
        p.vz = p.dashZ * DASH_SPEED;
      } else {
        const tx = acting ? p.inX * WALK : 0;
        const tz = acting ? p.inZ * WALK : 0;
        const k = 1 - Math.exp(-WALK_RESPONSE * DT);
        p.vx += (tx - p.vx) * k;
        p.vz += (tz - p.vz) * k;
      }
      if (Math.hypot(p.vx, p.vz) > 0.6) p.face = Math.atan2(p.vx, p.vz);
      const kd = Math.exp(-KNOCK_DECAY * DT);
      p.kx *= kd;
      p.kz *= kd;
      p.x += (p.vx + p.kx) * DT;
      p.z += (p.vz + p.kz) * DT;
      // Walking into the edge goes nowhere; only a shove or a crowd takes you over it.
      if (Math.hypot(p.kx, p.kz) < 1.5) {
        const out = outsideDeck(L, this.ring, p.x, p.z, this.walkCaps(), this.walkPlatform());
        if (out.o > 0) {
          p.x += out.nx * out.o;
          p.z += out.nz * out.o;
          const vn = -(p.vx * out.nx + p.vz * out.nz);
          if (vn > 0) {
            p.vx += out.nx * vn;
            p.vz += out.nz * vn;
          }
        }
      }
    }

    // Dash hits.
    for (let i = 0; i < this.players.length; i++) {
      const a = this.players[i];
      if (!a.alive || a.dash <= 0) continue;
      for (let j = 0; j < this.players.length; j++) {
        if (i === j) continue;
        const b = this.players[j];
        if (!b.alive || a.hit.includes(j)) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d > PLAYER_R * 2 + 0.2) continue;
        a.hit.push(j);
        const nx = d > 1e-6 ? dx / d : a.dashX;
        const nz = d > 1e-6 ? dz / d : a.dashZ;
        // Mostly the way the dash is going, a bit away from the shover.
        const kx = a.dashX * 0.7 + nx * 0.5;
        const kz = a.dashZ * 0.7 + nz * 0.5;
        const kl = Math.hypot(kx, kz) || 1;
        b.kx = (kx / kl) * KNOCK;
        b.kz = (kz / kl) * KNOCK;
        b.dash = 0;
        // The shover bounces back a little.
        a.kx -= nx * 2.5;
        a.kz -= nz * 2.5;
        a.dash = Math.min(a.dash, 0.06);
        ev.push({ t: 'hit', a: i, b: j, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
      }
    }

    // Soft circles.
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < this.players.length; i++) {
        const a = this.players[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < this.players.length; j++) {
          const b = this.players[j];
          if (!b.alive) continue;
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const d = Math.hypot(dx, dz);
          const min = PLAYER_R * 2;
          if (d >= min) continue;
          // Exactly on top of each other: split sideways in a stable direction.
          const nx = d > 1e-6 ? dx / d : Math.cos(i * 2.4 + j);
          const nz = d > 1e-6 ? dz / d : Math.sin(i * 2.4 + j);
          const push = (min - d) * Math.min(1, PUSH * DT) * 0.5;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
        }
      }
    }

    // The edge: you can lean over it, but a hard push sends you in.
    const caps = this.walkCaps();
    const plat = this.walkPlatform();
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive) continue;
      const out = outsideDeck(L, this.ring, p.x, p.z, caps, plat);
      if (out.o <= 0) continue;
      if (out.o > FALL_MARGIN && this.phase !== 'over' && this.phase !== 'sink' && this.phase !== 'rise' && this.phase !== 'ready') {
        this.dropIn(i, 'edge', ev);
        continue;
      }
      // Pulled back towards the deck; walking into the edge goes nowhere.
      const pull = out.o * Math.min(1, 14 * DT);
      p.x += out.nx * pull;
      p.z += out.nz * pull;
      const vn = p.vx * -out.nx + p.vz * -out.nz;
      if (vn > 0) {
        p.vx += out.nx * vn;
        p.vz += out.nz * vn;
      }
    }
    this.checkEndInto(ev);
  }

  private dropIn(i: number, why: 'sink' | 'edge', ev: MEvent[]) {
    const p = this.players[i];
    if (!p.alive) return;
    p.alive = false;
    p.fellAt = Math.round(this.time * 1000);
    p.fallT = 0;
    p.dash = 0;
    p.swimming = false;
    p.onBank = false;
    this.assignBank(p);
    ev.push({ t: 'fall', p: i, x: p.x, z: p.z, why });
  }

  /** The fallen swim to a spot on the bank on the side they fell, round the ring and across the open water. */
  private assignBank(p: MPlayer) {
    let side = p.x >= 0 ? 1 : -1;
    if (this.bankCount[side] >= 4) side = -side;
    const row = this.bankCount[side]++;
    p.bankX = side * (POND_R + 1.15) + (row % 2) * side * 0.35;
    p.bankZ = -4.8 + row * 3.3;
    const outR = this.L.ringR + this.L.capR + 1.5;
    const a0 = Math.atan2(p.z, p.x);
    const a1 = Math.atan2(p.bankZ, p.bankX);
    let da = a1 - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const path: { x: number; z: number }[] = [];
    // Straight out of the ring if inside it, then round the outside.
    const r0 = Math.hypot(p.x, p.z);
    if (r0 < outR) path.push({ x: Math.cos(a0) * outR, z: Math.sin(a0) * outR });
    for (let k = 1; k <= 3; k++) {
      const a = a0 + (da * k) / 4;
      path.push({ x: Math.cos(a) * (outR + 0.4), z: Math.sin(a) * (outR + 0.4) });
    }
    path.push({ x: p.bankX, z: p.bankZ });
    p.path = path;
  }

  private updateSwimmers() {
    for (const p of this.players) {
      if (p.alive || p.fellAt === null || !p.present) continue;
      p.fallT += DT;
      // Falls for ~0.45 s, bobs about, then swims.
      if (p.fallT < 1.0 || p.onBank) continue;
      p.swimming = true;
      const w = p.path[0];
      if (!w) {
        p.onBank = true;
        p.swimming = false;
        continue;
      }
      const dx = w.x - p.x;
      const dz = w.z - p.z;
      const d = Math.hypot(dx, dz);
      const step = 3.4 * DT;
      if (d <= step) {
        p.x = w.x;
        p.z = w.z;
        p.path.shift();
      } else {
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        p.face = Math.atan2(dx, dz);
      }
    }
  }

  private updateDown() {
    const sinking = this.phase === 'sink';
    const stay = this.phase === 'rise' ? false : sinking;
    this.cur.forEach((_, i) => {
      const want = stay && !this.safe.includes(i) ? 1 : 0;
      const rate = want === 1 ? DT / SINK_S : DT / RISE_S;
      this.capDown[i] = approach(this.capDown[i], want, rate);
    });
    const wantP = stay ? 1 : 0;
    this.platDown = approach(this.platDown, wantP, wantP === 1 ? DT / SINK_S : DT / RISE_S);
  }

  // ---- calls ---------------------------------------------------------------------

  private startCall(ev: MEvent[]) {
    const L = this.L;
    const n = ++this.callNo;
    if (n > MAX_CALLS) {
      this.finishRound(ev);
      return;
    }
    // Twin from the last call goes back to its own colour.
    if (this.twinCap !== null) {
      const j = this.twinCap;
      this.twinCap = null;
      if (this.cur[j] !== this.base[j]) {
        this.cur[j] = this.base[j];
        ev.push({ t: 'recolour', cap: j, to: this.cur[j] });
      }
    }
    let time = callTimeFor(n);
    this.omegaTo = spinFor(n) * (this.rng() < 0.5 ? -1 : 1);

    const swap = n >= 3 && !this.lastSwap && this.rng() < 0.3;
    const twin = !swap && n >= 5 && this.rng() < 0.3;
    this.lastSwap = swap;

    // Where can everyone get to in time?
    const alive = this.alive().map((i) => this.players[i]);
    const reach = (i: number, t: number) => alive.every((p) => capReachableFrom(L, this.ring, this.omegaTo, i, p.x, p.z, t));
    let cands = this.cur.map((_, i) => i).filter((i) => reach(i, time + (swap ? SWAP_BONUS_S : 0)));
    if (cands.length === 0) {
      // Spread right out: use the cap that is closest to everyone, and give them the time to reach it.
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < L.n; i++) {
        const c = capPos(L, this.ring, i);
        const d = Math.max(0, ...alive.map((p) => Math.hypot(c.x - p.x, c.z - p.z)));
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      cands = [best];
      time = Math.max(time, REACT_S + (bestD - L.capR * 0.7) / WALK + 0.2);
    }
    const fresh = cands.filter((i) => i !== this.prevTarget);
    const pool = fresh.length > 0 ? fresh : cands;
    const target = pool[Math.floor(this.rng() * pool.length)];
    this.prevTarget = target;

    if (swap) {
      time += SWAP_BONUS_S;
      const before = this.cur.slice();
      // Shuffle the colours until the target cap really changes and a fair few others do too.
      for (let tries = 0; tries < 40; tries++) {
        const perm = this.base.slice();
        for (let i = perm.length - 1; i > 0; i--) {
          const j = Math.floor(this.rng() * (i + 1));
          [perm[i], perm[j]] = [perm[j], perm[i]];
        }
        const changed = perm.filter((c, i) => c !== before[i]).length;
        if (perm[target] !== before[target] && changed >= Math.ceil(L.n / 2)) {
          this.base = perm;
          this.cur = perm.slice();
          break;
        }
      }
      if (this.cur[target] === before[target]) {
        // Fallback: swap the target with its neighbour.
        const j = (target + 1) % L.n;
        const nb = before.slice();
        [nb[target], nb[j]] = [nb[j], nb[target]];
        this.base = nb;
        this.cur = nb.slice();
      }
      this.cur.forEach((c, i) => c !== before[i] && ev.push({ t: 'recolour', cap: i, to: c }));
    }
    let twinCap: number | null = null;
    if (twin) {
      // A second cap in the called colour, well away from the first.
      const far = this.cur.map((_, i) => i).filter((i) => i !== target && Math.min((i - target + L.n) % L.n, (target - i + L.n) % L.n) >= 2);
      if (far.length > 0) {
        twinCap = far[Math.floor(this.rng() * far.length)];
        this.cur[twinCap] = this.cur[target];
        this.twinCap = twinCap;
        ev.push({ t: 'recolour', cap: twinCap, to: this.cur[twinCap] });
      }
    }
    this.targetCap = target;
    this.targetColour = this.cur[target];
    this.safe = this.cur.map((c, i) => (c === this.targetColour ? i : -1)).filter((i) => i >= 0);
    this.callTime = time;
    this.callLeft = time;
    this.go('call');
    ev.push({ t: 'call', n, colour: this.targetColour, time, swap, twin: twinCap, target });
  }

  /** The timer ran out: everything but the called colour sinks. */
  private resolve(ev: MEvent[]) {
    const fell: number[] = [];
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive) continue;
      if (!survivesSink(this.L, this.ring, p.x, p.z, this.safe)) fell.push(i);
    }
    for (const i of fell) this.dropIn(i, 'sink', ev);
    this.lastFell = fell;
    this.go('sink');
    ev.push({ t: 'sink', fell, safe: this.safe.slice() });
    if (this.alive().length <= 1) this.finishRoundAfterSink();
  }

  private finishRoundAfterSink() {
    const alive = this.alive();
    this.ended = true;
    this.winner = alive.length === 1 ? alive[0] : null;
  }

  private checkEnd(): MEvent[] {
    const ev: MEvent[] = [];
    this.checkEndInto(ev);
    return ev;
  }

  /** A fall outside the sink (a shove) can end the round on the spot. */
  private checkEndInto(ev: MEvent[]) {
    if (this.ended || this.phase === 'over' || this.phase === 'ready') return;
    if (this.phase === 'sink') return;
    if (this.alive().length <= 1) this.finishRound(ev);
  }

  private finishRound(ev: MEvent[]) {
    const alive = this.alive();
    this.ended = true;
    this.winner = alive.length === 1 ? alive[0] : null;
    this.go('over');
    ev.push({ t: 'over', winner: this.winner, fresh: true });
  }

  /** Round result so far (also used for the final scoring). */
  result(): RoundResult {
    return roundPoints(
      this.players.map((p) => p.fellAt),
      this.players.map((p) => p.present),
    );
  }
}

export function howTo(short: boolean): string[] {
  return [
    'Babcia holds up a colour. Run to the mushroom of that colour!',
    short ? 'When the ring runs out, everything else sinks – wrong cap, in the pond.' : 'When the ring runs out, everything else sinks – anyone on the wrong cap falls in the pond.',
    short ? 'Shove rivals off. Last one dry wins!' : 'Shove rivals off the cap. Calls get faster; last pierogi dry wins the round. Three rounds.',
  ];
}
