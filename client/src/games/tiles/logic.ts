/**
 * Kafelki: the pure rules. A kitchen floor of square tiles; walk over a tile to paint it your colour,
 * Roll (a rolling-pin dash) paints a 3-wide streak and stuns whoever you hit, Splat lobs a paint bomb
 * that paints a 3×3 blob. From the middle of the round tiles crack and crumble into holes, and Babcia's
 * mop sweeps rows clean. No DOM and no three.js in here.
 */
export const DT = 1 / 60;

/** Edge of one tile, metres. */
export const TILE = 1.6;
export const ROUND_S = 60;
export const ROUND_S_SHORT = 45;
export const ROUNDS = 2;
export const ROUNDS_SHORT = 1;

export const WALK = 6;
export const ACCEL = 60;
export const PLAYER_R = 0.8;
export const DEADZONE = 0.14;

export const DASH_TIME = 0.5;
export const DASH_SPEED = 16;
export const ROLL_CD = 3;
export const SPLAT_CD = 6;
export const SPLAT_RANGE = 6;
export const SPLAT_FLIGHT = 0.7;
export const STUN = 1;
export const MOP_STUN = 0.8;
/** A button pressed this long before it is ready still counts. */
export const BUFFER = 0.25;

export const FALL_RESPAWN = 2;
export const CRACK_WARN = 2;
export const HOLE_TIME = 4;

export const MOP_WARN = 1.8;
export const MOP_SWEEP = 2.4;

/** Tile kinds. */
export const OK = 0;
export const CRACKED = 1;
export const HOLE = 2;

/** Floor size in tiles for a number of players. */
export function gridFor(n: number): { cols: number; rows: number } {
  if (n <= 3) return { cols: 12, rows: 8 };
  if (n <= 5) return { cols: 16, rows: 10 };
  return { cols: 20, rows: 12 };
}

export interface TilesInput {
  /** Joystick, -1..1 each; +x right, +z towards the viewer. */
  x: number;
  z: number;
  /** A press of Roll / Splat since the last step. */
  roll?: boolean;
  splat?: boolean;
}

export interface TilesPlayer {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing (unit vector). */
  fx: number;
  fz: number;
  /** Seconds of stun left. */
  stun: number;
  /** Seconds of dash left, and its direction. */
  dash: number;
  dx: number;
  dz: number;
  /** Which way the 3-wide streak spreads: the dash runs along this axis. */
  axis: 'x' | 'z';
  hit: number[];
  rollCd: number;
  splatCd: number;
  rollBuf: number;
  splatBuf: number;
  /** Seconds until respawn while fallen in a hole (0 = standing). */
  down: number;
  alive: boolean;
  /** How far the stick is pushed (0..1), for walking animations. */
  speed: number;
}

export interface Bomb {
  p: number;
  sx: number;
  sz: number;
  tx: number;
  tz: number;
  t: number;
}

export interface Mop {
  /** The mop covers rows `row` and `row + 1`. */
  row: number;
  dir: 1 | -1;
  warn: number;
  active: boolean;
  /** x of the mop head. */
  head: number;
  hit: number[];
}

export type TilesEvent =
  | { t: 'paint'; tile: number; by: number; prev: number }
  | { t: 'wipe'; tile: number; prev: number }
  | { t: 'roll'; p: number }
  | { t: 'throw'; p: number; sx: number; sz: number; tx: number; tz: number }
  | { t: 'land'; p: number; x: number; z: number; tile: number }
  | { t: 'stun'; p: number; by: number; kind: 'roll' | 'splat' | 'mop' }
  | { t: 'crack'; tile: number }
  | { t: 'crumble'; tile: number }
  | { t: 'fresh'; tile: number }
  | { t: 'fall'; p: number; x: number; z: number; tile: number }
  | { t: 'respawn'; p: number; x: number; z: number }
  | { t: 'mopWarn'; row: number; dir: 1 | -1 }
  | { t: 'mopStart'; row: number; dir: 1 | -1 }
  | { t: 'mopEnd' };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export interface TilesOptions {
  short?: boolean;
  rng?: () => number;
  cols?: number;
  rows?: number;
  length?: number;
}

export class TilesSim {
  readonly cols: number;
  readonly rows: number;
  readonly n: number;
  /** Round length, seconds. */
  readonly length: number;
  time = 0;
  /** Player index per tile, -1 = unclaimed. */
  readonly owner: Int16Array;
  readonly kind: Uint8Array;
  /** Seconds left before a cracked tile crumbles / a hole is replaced. */
  readonly timer: Float32Array;
  readonly players: TilesPlayer[] = [];
  readonly bombs: Bomb[] = [];
  mop: Mop | null = null;
  /** Tiles owned per player. */
  readonly counts: number[];
  private events: TilesEvent[] = [];
  private readonly rng: () => number;
  private nextCrack: number;
  private nextMop: number;
  private readonly special = new Set<number>();
  private readonly crackEvery: number;
  private readonly crackCount: number;

  constructor(
    n: number,
    opts: TilesOptions = {},
  ) {
    this.rng = opts.rng ?? Math.random;
    const g = gridFor(n);
    this.cols = opts.cols ?? g.cols;
    this.rows = opts.rows ?? g.rows;
    this.n = n;
    this.length = opts.length ?? (opts.short ? ROUND_S_SHORT : ROUND_S);
    this.owner = new Int16Array(this.cols * this.rows).fill(-1);
    this.kind = new Uint8Array(this.cols * this.rows);
    this.timer = new Float32Array(this.cols * this.rows);
    this.counts = Array.from({ length: n }, () => 0);
    const k = this.length / ROUND_S;
    this.nextCrack = this.length * 0.5;
    this.crackEvery = 2.4 * k;
    this.crackCount = this.cols >= 20 ? 4 : this.cols >= 16 ? 3 : 2;
    this.nextMop = this.length * 0.27;
    // Players start on a ring, facing the middle, each owning the tile they stand on.
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(a) * this.W * 0.3;
      const pz = Math.sin(a) * this.H * 0.3;
      const t = this.tileAt(px, pz);
      const c = this.centre(t);
      const len = Math.hypot(c.x, c.z) || 1;
      this.players.push({
        x: c.x,
        z: c.z,
        vx: 0,
        vz: 0,
        fx: -c.x / len,
        fz: c.z === 0 && c.x === 0 ? 1 : -c.z / len,
        stun: 0,
        dash: 0,
        dx: 0,
        dz: 1,
        axis: 'x',
        hit: [],
        rollCd: 0,
        splatCd: 0,
        rollBuf: 0,
        splatBuf: 0,
        down: 0,
        alive: true,
        speed: 0,
      });
      this.setOwner(t, i);
    }
  }

  get W() {
    return this.cols * TILE;
  }
  get H() {
    return this.rows * TILE;
  }
  get done() {
    return this.time >= this.length;
  }
  get left() {
    return Math.max(0, this.length - this.time);
  }

  // ---- geometry ---------------------------------------------------------------

  /** Tile index under a world point (clamped to the floor). */
  tileAt(x: number, z: number) {
    const cx = clamp(Math.floor((x + this.W / 2) / TILE), 0, this.cols - 1);
    const cz = clamp(Math.floor((z + this.H / 2) / TILE), 0, this.rows - 1);
    return cz * this.cols + cx;
  }
  cx(tile: number) {
    return tile % this.cols;
  }
  cz(tile: number) {
    return Math.floor(tile / this.cols);
  }
  idx(cx: number, cz: number) {
    return cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows ? -1 : cz * this.cols + cx;
  }
  centre(tile: number) {
    return { x: (this.cx(tile) + 0.5) * TILE - this.W / 2, z: (this.cz(tile) + 0.5) * TILE - this.H / 2 };
  }

  // ---- ownership --------------------------------------------------------------

  setOwner(tile: number, p: number) {
    const prev = this.owner[tile];
    if (prev === p) return prev;
    if (prev >= 0) this.counts[prev]--;
    if (p >= 0) this.counts[p]++;
    this.owner[tile] = p;
    return prev;
  }

  private paint(tile: number, p: number) {
    if (tile < 0 || this.kind[tile] === HOLE || this.owner[tile] === p) return;
    const prev = this.setOwner(tile, p);
    this.events.push({ t: 'paint', tile, by: p, prev });
  }

  /** Scores for the round: tiles owned. */
  scores() {
    return this.counts.slice();
  }

  /** Player indices, most tiles first (ties keep join order). */
  ranking() {
    return this.counts
      .map((c, i) => ({ c, i }))
      .filter((x) => this.players[x.i].alive)
      .sort((a, b) => b.c - a.c || a.i - b.i)
      .map((x) => x.i);
  }

  /** A player leaves for good: their paint goes back to white. */
  remove(p: number) {
    const pl = this.players[p];
    if (!pl || !pl.alive) return;
    pl.alive = false;
    pl.dash = 0;
    for (let t = 0; t < this.owner.length; t++) if (this.owner[t] === p) this.setOwner(t, -1);
    for (let i = this.bombs.length - 1; i >= 0; i--) if (this.bombs[i].p === p) this.bombs.splice(i, 1);
  }

  // ---- the step ---------------------------------------------------------------

  step(inputs: (TilesInput | undefined)[]): TilesEvent[] {
    const ev = (this.events = []);
    this.time += DT;
    this.tickTiles();
    this.tickMop();
    for (let i = 0; i < this.n; i++) this.control(i, inputs[i]);
    this.tickBombs();
    this.collide();
    for (let i = 0; i < this.n; i++) this.paintUnder(i);
    return ev;
  }

  private control(i: number, inp: TilesInput = { x: 0, z: 0 }) {
    const p = this.players[i];
    if (!p.alive) return;
    p.rollCd = Math.max(0, p.rollCd - DT);
    p.splatCd = Math.max(0, p.splatCd - DT);
    p.rollBuf = Math.max(0, p.rollBuf - DT);
    p.splatBuf = Math.max(0, p.splatBuf - DT);
    if (p.down > 0) {
      p.down -= DT;
      if (p.down <= 0) this.respawn(i);
      return;
    }
    if (inp.roll) p.rollBuf = BUFFER;
    if (inp.splat) p.splatBuf = BUFFER;
    let mx = Number(inp.x) || 0;
    let mz = Number(inp.z) || 0;
    let mag = Math.hypot(mx, mz);
    if (mag > 1) {
      mx /= mag;
      mz /= mag;
      mag = 1;
    }
    if (mag < DEADZONE) {
      mx = mz = mag = 0;
    }
    p.speed = mag;
    if (p.stun > 0) {
      p.stun = Math.max(0, p.stun - DT);
      const k = Math.exp(-5 * DT);
      p.vx *= k;
      p.vz *= k;
    } else if (p.dash > 0) {
      p.dash = Math.max(0, p.dash - DT);
      p.vx = p.dx * DASH_SPEED;
      p.vz = p.dz * DASH_SPEED;
      this.dashHits(i);
      if (p.dash === 0) {
        p.vx *= 0.25;
        p.vz *= 0.25;
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
      if (p.rollBuf > 0 && p.rollCd <= 0) this.startRoll(i);
      else if (p.splatBuf > 0 && p.splatCd <= 0) this.throwSplat(i);
    }
    p.x += p.vx * DT;
    p.z += p.vz * DT;
    const mxp = this.W / 2 - PLAYER_R * 0.8;
    const mzp = this.H / 2 - PLAYER_R * 0.8;
    p.x = clamp(p.x, -mxp, mxp);
    p.z = clamp(p.z, -mzp, mzp);
  }

  private startRoll(i: number) {
    const p = this.players[i];
    p.dash = DASH_TIME;
    p.dx = p.fx;
    p.dz = p.fz;
    p.axis = Math.abs(p.dx) >= Math.abs(p.dz) ? 'x' : 'z';
    p.hit = [];
    p.rollCd = ROLL_CD;
    p.rollBuf = 0;
    p.vx = p.dx * DASH_SPEED;
    p.vz = p.dz * DASH_SPEED;
    this.events.push({ t: 'roll', p: i });
  }

  private throwSplat(i: number) {
    const p = this.players[i];
    const tx = clamp(p.x + p.fx * SPLAT_RANGE, -this.W / 2 + 0.05, this.W / 2 - 0.05);
    const tz = clamp(p.z + p.fz * SPLAT_RANGE, -this.H / 2 + 0.05, this.H / 2 - 0.05);
    this.bombs.push({ p: i, sx: p.x, sz: p.z, tx, tz, t: 0 });
    p.splatCd = SPLAT_CD;
    p.splatBuf = 0;
    this.events.push({ t: 'throw', p: i, sx: p.x, sz: p.z, tx, tz });
  }

  private stunPlayer(j: number, by: number, kind: 'roll' | 'splat' | 'mop', time: number) {
    const o = this.players[j];
    o.stun = Math.max(o.stun, time);
    o.dash = 0;
    this.events.push({ t: 'stun', p: j, by, kind });
  }

  /** A dashing rolling pin bowls over anyone it touches. */
  private dashHits(i: number) {
    const p = this.players[i];
    for (let j = 0; j < this.n; j++) {
      const o = this.players[j];
      if (j === i || !o.alive || o.down > 0 || p.hit.includes(j)) continue;
      if (Math.hypot(o.x - p.x, o.z - p.z) < PLAYER_R * 2 + 0.15) {
        p.hit.push(j);
        if (o.stun > 0) continue;
        this.stunPlayer(j, i, 'roll', STUN);
        o.vx = p.dx * 9;
        o.vz = p.dz * 9;
      }
    }
  }

  private tickBombs() {
    for (let b = this.bombs.length - 1; b >= 0; b--) {
      const bomb = this.bombs[b];
      bomb.t += DT;
      if (bomb.t < SPLAT_FLIGHT) continue;
      this.bombs.splice(b, 1);
      this.land(bomb);
    }
  }

  /** The bomb comes down: the 3×3 tiles around the landing tile turn the thrower's colour. */
  private land(b: Bomb) {
    const tile = this.tileAt(b.tx, b.tz);
    const cx = this.cx(tile);
    const cz = this.cz(tile);
    this.events.push({ t: 'land', p: b.p, x: b.tx, z: b.tz, tile });
    if (!this.players[b.p]?.alive) return;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.paint(this.idx(cx + dx, cz + dz), b.p);
    for (let j = 0; j < this.n; j++) {
      const o = this.players[j];
      if (j === b.p || !o.alive || o.down > 0) continue;
      const ot = this.tileAt(o.x, o.z);
      if (Math.abs(this.cx(ot) - cx) <= 1 && Math.abs(this.cz(ot) - cz) <= 1) {
        const d = Math.hypot(o.x - b.tx, o.z - b.tz) || 1;
        this.stunPlayer(j, b.p, 'splat', STUN);
        o.vx = ((o.x - b.tx) / d) * 4;
        o.vz = ((o.z - b.tz) / d) * 4;
      }
    }
  }

  /** Soft circles: overlapping players are pushed apart (a dashing player doesn't give way). */
  private collide() {
    for (let i = 0; i < this.n; i++) {
      const a = this.players[i];
      if (!a.alive || a.down > 0) continue;
      for (let j = i + 1; j < this.n; j++) {
        const b = this.players[j];
        if (!b.alive || b.down > 0) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = PLAYER_R * 2;
        if (d >= min) continue;
        const nx = d > 1e-6 ? dx / d : 1;
        const nz = d > 1e-6 ? dz / d : 0;
        const push = min - d;
        const wa = a.dash > 0 ? 0 : b.dash > 0 ? 1 : 0.5;
        const wb = 1 - wa;
        a.x -= nx * push * wa;
        a.z -= nz * push * wa;
        b.x += nx * push * wb;
        b.z += nz * push * wb;
      }
    }
  }

  private paintUnder(i: number) {
    const p = this.players[i];
    if (!p.alive || p.down > 0) return;
    const t = this.tileAt(p.x, p.z);
    if (this.kind[t] === HOLE) {
      // Rolling across a hole is fine; stopping on one is not.
      if (p.dash > 0) return;
      p.down = FALL_RESPAWN;
      p.vx = p.vz = 0;
      p.stun = 0;
      p.dash = 0;
      this.events.push({ t: 'fall', p: i, x: p.x, z: p.z, tile: t });
      return;
    }
    if (p.stun > 0) return;
    this.paint(t, i);
    if (p.dash > 0) {
      const cx = this.cx(t);
      const cz = this.cz(t);
      // The streak is 3 tiles wide, across the dash.
      if (p.axis === 'x') {
        this.paint(this.idx(cx, cz - 1), i);
        this.paint(this.idx(cx, cz + 1), i);
      } else {
        this.paint(this.idx(cx - 1, cz), i);
        this.paint(this.idx(cx + 1, cz), i);
      }
    }
  }

  private respawn(i: number) {
    const p = this.players[i];
    let best = -1;
    let bestD = -1;
    for (let k = 0; k < 14; k++) {
      const edge = Math.floor(this.rng() * 4);
      const cx = edge < 2 ? Math.floor(this.rng() * this.cols) : edge === 2 ? 0 : this.cols - 1;
      const cz = edge >= 2 ? Math.floor(this.rng() * this.rows) : edge === 0 ? 0 : this.rows - 1;
      const t = this.idx(cx, cz);
      if (this.kind[t] === HOLE) continue;
      const c = this.centre(t);
      let d = 99;
      for (let j = 0; j < this.n; j++) {
        const o = this.players[j];
        if (j !== i && o.alive && o.down <= 0) d = Math.min(d, Math.hypot(o.x - c.x, o.z - c.z));
      }
      if (d > bestD) {
        bestD = d;
        best = t;
      }
      if (d > 5) break;
    }
    if (best < 0) best = this.tileAt(0, 0);
    const c = this.centre(best);
    p.x = c.x;
    p.z = c.z;
    p.vx = p.vz = 0;
    p.down = 0;
    p.stun = 0;
    p.dash = 0;
    const len = Math.hypot(c.x, c.z) || 1;
    p.fx = -c.x / len;
    p.fz = -c.z / len;
    this.events.push({ t: 'respawn', p: i, x: c.x, z: c.z });
  }

  // ---- tribulations -----------------------------------------------------------

  private tickTiles() {
    if (this.time >= this.nextCrack && this.time < this.length - CRACK_WARN - 0.5) {
      this.nextCrack += this.crackEvery;
      for (let k = 0, tries = 0; k < this.crackCount && tries < 60; tries++) {
        const t = Math.floor(this.rng() * this.kind.length);
        if (this.kind[t] !== OK) continue;
        this.crack(t);
        k++;
      }
    }
    for (const t of this.special) {
      this.timer[t] -= DT;
      if (this.timer[t] > 0) continue;
      if (this.kind[t] === CRACKED) {
        this.kind[t] = HOLE;
        this.timer[t] = HOLE_TIME;
        this.setOwner(t, -1);
        this.events.push({ t: 'crumble', tile: t });
      } else {
        this.kind[t] = OK;
        this.special.delete(t);
        this.events.push({ t: 'fresh', tile: t });
      }
    }
  }

  /** Start cracking a tile (it crumbles after CRACK_WARN seconds). */
  crack(tile: number) {
    if (this.kind[tile] !== OK) return;
    this.kind[tile] = CRACKED;
    this.timer[tile] = CRACK_WARN;
    this.special.add(tile);
    this.events.push({ t: 'crack', tile });
  }

  private tickMop() {
    const m = this.mop;
    if (!m) {
      if (this.time >= this.nextMop && this.time < this.length - 6) {
        const dir = this.rng() < 0.5 ? 1 : -1;
        this.startMop(Math.floor(this.rng() * (this.rows - 1)), dir);
      }
      return;
    }
    if (!m.active) {
      m.warn -= DT;
      if (m.warn <= 0) {
        m.active = true;
        this.events.push({ t: 'mopStart', row: m.row, dir: m.dir });
      }
      return;
    }
    m.head += (m.dir * (this.W + 4)) / MOP_SWEEP * DT;
    const z0 = m.row * TILE - this.H / 2;
    for (let r = m.row; r <= m.row + 1; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = (c + 0.5) * TILE - this.W / 2;
        if (Math.abs(x - m.head) > TILE * 0.6) continue;
        const t = r * this.cols + c;
        const prev = this.owner[t];
        if (prev >= 0) {
          this.setOwner(t, -1);
          this.events.push({ t: 'wipe', tile: t, prev });
        }
      }
    }
    for (let j = 0; j < this.n; j++) {
      const o = this.players[j];
      if (!o.alive || o.down > 0 || m.hit.includes(j)) continue;
      if (o.z > z0 - 0.4 && o.z < z0 + TILE * 2 + 0.4 && Math.abs(o.x - m.head) < 1) {
        m.hit.push(j);
        this.stunPlayer(j, -1, 'mop', MOP_STUN);
        o.vx = m.dir * 8;
        o.vz = 0;
      }
    }
    if ((m.dir > 0 && m.head > this.W / 2 + 2) || (m.dir < 0 && m.head < -this.W / 2 - 2)) {
      this.mop = null;
      this.nextMop = this.time + 8.5 * (this.length / ROUND_S) + this.rng() * 3;
      this.events.push({ t: 'mopEnd' });
    }
  }

  /** Telegraph a mop sweep along two rows. */
  startMop(row: number, dir: 1 | -1) {
    this.mop = { row, dir, warn: MOP_WARN, active: false, head: -dir * (this.W / 2 + 2), hit: [] };
    this.events.push({ t: 'mopWarn', row, dir });
  }
}

/** Short text for the phone after a round. */
export function placeText(place: number) {
  return ['', '1st', '2nd', '3rd'][place] ?? `${place}th`;
}

export function howTo(short: boolean): string[] {
  return ['Walk to paint tiles your colour', 'Roll to dash · Splat to bomb', short ? 'Most tiles after 45 seconds wins' : 'Most tiles after 2 × 60 seconds wins'];
}
