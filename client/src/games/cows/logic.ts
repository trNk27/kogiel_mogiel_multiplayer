/**
 * Krówki: the pure rules. A meadow with a pen for every player along its top and bottom edges, and a
 * herd of cows in the middle, a few in each player's colour. Walk up to one of your cows, face it and
 * throw the lasso; then drag it home on a rope that stretches a little. A cow led through your gate is
 * penned. Other players can't walk through your rope (and neither can loose cows), so a rope makes a
 * moving fence. First to pen all their cows ends the round; otherwise the clock does. No DOM and no
 * three.js in here.
 */
export const DT = 1 / 60;

export const ROUND_S = 90;
export const ROUND_S_SHORT = 75;
export const ROUNDS = 2;
export const ROUNDS_SHORT = 1;
/** Cows of each colour. */
export const COWS_EACH = 6;
/** Bonus for the player who pens all their cows first. */
export const FINISH_BONUS = 3;

export const WALK = 6.5;
/** Walking speed while dragging a cow. */
export const DRAG_WALK = 4.6;
export const ACCEL = 50;
export const PLAYER_R = 0.7;
export const COW_R = 0.8;
export const ROPE_R = 0.12;
export const DEADZONE = 0.14;

/** How far the lasso reaches, and how wide (either side of where you face) it catches. */
export const LASSO_RANGE = 5;
export const LASSO_COS = Math.cos((50 * Math.PI) / 180);
/** Cows this close can be caught whichever way you face. */
export const LASSO_NEAR = 1.9;
/** Seconds the loop is in the air. */
export const THROW_TIME = 0.28;
/** A cow that moved away while the loop flew is still caught up to this far beyond the range. */
export const CATCH_SLACK = 1.2;
export const MISS_CD = 0.7;
export const RELEASE_CD = 0.35;
/** The rope: slack up to ROPE_LEN, stretching up to ROPE_MAX before the cow has to come along. */
export const ROPE_LEN = 2.6;
export const ROPE_MAX = 3.4;
/** How hard a stretched rope tugs (m/s of cow speed per metre of stretch), and the fastest a cow is dragged. */
export const TUG = 9;
export const COW_DRAG_MAX = 7;

export const COW_WALK = 1.1;

/** Pens: a square of fence with a gate in the side facing the meadow. */
export const PEN = 6.4;
export const GATE = 2.8;
/** How far past the gate a cow has to be to count as penned. */
export const PEN_DEPTH = 1.1;

export interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

export interface Pen {
  /** Centre. */
  x: number;
  z: number;
  /** Which way the gate faces: +1 opens towards +z (top row), -1 towards -z (bottom row). */
  dir: 1 | -1;
  /** Fence segments (players and cows bump into these). */
  walls: Seg[];
  /** The gap in the fence: only a cow being led into its own pen gets through. */
  gate: Seg;
}

export interface CowsInput {
  /** Joystick, -1..1 each; +x right, +z towards the viewer. */
  x: number;
  z: number;
  /** A press of the lasso button since the last step. */
  lasso?: boolean;
}

export interface CowsPlayer {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing (unit vector). */
  fx: number;
  fz: number;
  /** How far the stick is pushed (0..1), for walking animations. */
  speed: number;
  /** The cow on the end of this player's rope, or -1. */
  hold: number;
  /** Seconds the loop has been in the air (0 = not throwing), the cow it's aimed at (-1 = none) and where it lands. */
  throwT: number;
  throwAt: number;
  tx: number;
  tz: number;
  /** Seconds before the lasso can be thrown again. */
  cd: number;
  /** The cow the lasso would catch right now (for the target ring), or -1. */
  aim: number;
  penned: number;
  alive: boolean;
}

export interface Cow {
  /** Whose colour it is. */
  owner: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Heading, radians (0 faces +z). */
  rot: number;
  /** The player leading it, or -1. */
  heldBy: number;
  penned: boolean;
  alive: boolean;
  /** Wandering: seconds left of the current walk or graze, and the walk's direction. */
  wander: number;
  walking: boolean;
  wx: number;
  wz: number;
}

export type CowsEvent =
  | { t: 'throw'; p: number; x: number; z: number }
  | { t: 'catch'; p: number; cow: number }
  | { t: 'miss'; p: number }
  | { t: 'release'; p: number; cow: number }
  | { t: 'pen'; p: number; cow: number; count: number }
  | { t: 'done'; p: number }
  | { t: 'moo'; cow: number };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Meadow size in metres for a number of players: pens sit in two rows, so it widens with the players. */
export function fieldFor(n: number): { w: number; h: number } {
  const cols = Math.ceil(Math.max(1, n) / 2);
  return { w: Math.max(30, cols * 11), h: n <= 2 ? 22 : 24 };
}

/** Pens for n players: the first half along the top edge, the rest along the bottom, gates facing the middle. */
export function pensFor(n: number, w: number, h: number): Pen[] {
  const top = Math.ceil(n / 2);
  const out: Pen[] = [];
  for (let i = 0; i < n; i++) {
    const row = i < top ? 0 : 1;
    const k = row ? i - top : i;
    const count = row ? n - top : top;
    const x = -w / 2 + (w * (k + 0.5)) / count;
    const dir: 1 | -1 = row ? -1 : 1;
    const z = row ? h / 2 - PEN / 2 : -h / 2 + PEN / 2;
    out.push(buildPen(x, z, dir));
  }
  return out;
}

function buildPen(x: number, z: number, dir: 1 | -1): Pen {
  const s = PEN / 2;
  const g = GATE / 2;
  const back = z - dir * s;
  const front = z + dir * s;
  const seg = (ax: number, az: number, bx: number, bz: number): Seg => ({ ax, az, bx, bz });
  return {
    x,
    z,
    dir,
    walls: [
      seg(x - s, back, x + s, back),
      seg(x - s, back, x - s, front),
      seg(x + s, back, x + s, front),
      seg(x - s, front, x - g, front),
      seg(x + g, front, x + s, front),
    ],
    gate: seg(x - g, front, x + g, front),
  };
}

/** Closest point on a segment to (px, pz): returns [x, z, t]. */
function closest(s: Seg, px: number, pz: number): [number, number, number] {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((px - s.ax) * dx + (pz - s.az) * dz) / l2, 0, 1) : 0;
  return [s.ax + dx * t, s.az + dz * t, t];
}

export interface CowsOptions {
  short?: boolean;
  rng?: () => number;
  length?: number;
  cowsEach?: number;
}

export class CowsSim {
  readonly n: number;
  readonly w: number;
  readonly h: number;
  /** Round length, seconds. */
  readonly length: number;
  readonly cowsEach: number;
  time = 0;
  readonly players: CowsPlayer[] = [];
  readonly cows: Cow[] = [];
  readonly pens: Pen[];
  /** Who penned all their cows first (ends the round), or -1. */
  winner = -1;
  private events: CowsEvent[] = [];
  private readonly rng: () => number;
  private nextMoo: number;

  constructor(n: number, opts: CowsOptions = {}) {
    this.rng = opts.rng ?? Math.random;
    this.n = n;
    const f = fieldFor(n);
    this.w = f.w;
    this.h = f.h;
    this.length = opts.length ?? (opts.short ? ROUND_S_SHORT : ROUND_S);
    this.cowsEach = opts.cowsEach ?? COWS_EACH;
    this.pens = pensFor(n, this.w, this.h);
    this.nextMoo = 1.5;
    // Everyone starts just outside their own gate, facing the herd.
    for (let i = 0; i < n; i++) {
      const pen = this.pens[i];
      this.players.push({
        x: pen.x,
        z: pen.z + pen.dir * (PEN / 2 + 1.6),
        vx: 0,
        vz: 0,
        fx: 0,
        fz: pen.dir,
        speed: 0,
        hold: -1,
        throwT: 0,
        throwAt: -1,
        tx: 0,
        tz: 0,
        cd: 0,
        aim: -1,
        penned: 0,
        alive: true,
      });
    }
    // The herd: every colour mixed up on a jittered grid in the middle of the meadow.
    const total = n * this.cowsEach;
    const owners: number[] = [];
    for (let i = 0; i < n; i++) for (let k = 0; k < this.cowsEach; k++) owners.push(i);
    for (let k = owners.length - 1; k > 0; k--) {
      const j = Math.floor(this.rng() * (k + 1));
      [owners[k], owners[j]] = [owners[j], owners[k]];
    }
    const band = this.h / 2 - PEN - 1.8;
    const spanX = Math.min(this.w / 2 - 4, 3 + total * 0.32);
    const cols = Math.max(1, Math.round(Math.sqrt((total * spanX) / band)));
    const rows = Math.ceil(total / cols);
    for (let k = 0; k < total; k++) {
      const c = k % cols;
      const r = Math.floor(k / cols);
      const x = (cols === 1 ? 0 : -spanX + (2 * spanX * c) / (cols - 1)) + (this.rng() - 0.5) * 1.2;
      const z = (rows === 1 ? 0 : -band + (2 * band * r) / (rows - 1)) + (this.rng() - 0.5) * 1.2;
      this.cows.push({
        owner: owners[k],
        x,
        z,
        vx: 0,
        vz: 0,
        rot: this.rng() * Math.PI * 2,
        heldBy: -1,
        penned: false,
        alive: true,
        wander: this.rng() * 3,
        walking: false,
        wx: 0,
        wz: 0,
      });
    }
  }

  get done() {
    return this.time >= this.length || this.winner >= 0;
  }
  get left() {
    return Math.max(0, this.length - this.time);
  }

  /** Cows penned per player, plus the finisher's bonus. */
  scores() {
    return this.players.map((p, i) => (p.alive ? p.penned + (i === this.winner ? FINISH_BONUS : 0) : 0));
  }

  /** Player indices, most cows penned first (the finisher wins ties; then join order). */
  ranking() {
    const s = this.scores();
    return this.players
      .map((p, i) => ({ p, i }))
      .filter((x) => x.p.alive)
      .sort((a, b) => s[b.i] - s[a.i] || a.i - b.i)
      .map((x) => x.i);
  }

  /** A player leaves for good: their rope goes slack and their cows wander off the field. */
  remove(i: number) {
    const p = this.players[i];
    if (!p || !p.alive) return;
    this.letGo(i, false);
    p.alive = false;
    for (const c of this.cows) if (c.owner === i) c.alive = false;
  }

  // ---- the step ---------------------------------------------------------------

  step(inputs: (CowsInput | undefined)[]): CowsEvent[] {
    const ev = (this.events = []);
    if (this.done) return ev;
    this.time += DT;
    for (let i = 0; i < this.n; i++) this.control(i, inputs[i]);
    this.cows.forEach((c, k) => c.alive && this.moveCow(k));
    for (let it = 0; it < 2; it++) {
      this.collideBodies();
      this.ropeFences();
      this.walls();
    }
    this.tetherAll();
    this.checkPens();
    this.aimAll();
    this.moos();
    return ev;
  }

  private control(i: number, inp: CowsInput = { x: 0, z: 0 }) {
    const p = this.players[i];
    if (!p.alive) return;
    p.cd = Math.max(0, p.cd - DT);
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
    const top = p.hold >= 0 ? DRAG_WALK : WALK;
    const tx = mx * top;
    const tz = mz * top;
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
    p.x += p.vx * DT;
    p.z += p.vz * DT;

    if (inp.lasso) this.pressLasso(i);
    if (p.throwT > 0) {
      p.throwT += DT;
      if (p.throwT >= THROW_TIME) this.land(i);
    }
  }

  private pressLasso(i: number) {
    const p = this.players[i];
    if (p.hold >= 0) {
      this.letGo(i, true);
      return;
    }
    if (p.throwT > 0 || p.cd > 0) return;
    const target = this.target(i);
    p.throwT = DT;
    p.throwAt = target;
    if (target >= 0) {
      p.tx = this.cows[target].x;
      p.tz = this.cows[target].z;
    } else {
      p.tx = p.x + p.fx * LASSO_RANGE;
      p.tz = p.z + p.fz * LASSO_RANGE;
    }
    this.events.push({ t: 'throw', p: i, x: p.tx, z: p.tz });
  }

  /** The loop comes down: a catch if the cow is still within reach and free. */
  private land(i: number) {
    const p = this.players[i];
    const k = p.throwAt;
    p.throwT = 0;
    p.throwAt = -1;
    const c = k >= 0 ? this.cows[k] : undefined;
    if (c && c.alive && !c.penned && c.heldBy < 0 && Math.hypot(c.x - p.x, c.z - p.z) <= LASSO_RANGE + CATCH_SLACK) {
      p.hold = k;
      c.heldBy = i;
      c.walking = false;
      this.events.push({ t: 'catch', p: i, cow: k });
      return;
    }
    p.cd = MISS_CD;
    this.events.push({ t: 'miss', p: i });
  }

  private letGo(i: number, loud: boolean) {
    const p = this.players[i];
    p.throwT = 0;
    p.throwAt = -1;
    if (p.hold < 0) return;
    const k = p.hold;
    this.cows[k].heldBy = -1;
    this.cows[k].wander = 0.8 + this.rng();
    p.hold = -1;
    p.cd = RELEASE_CD;
    if (loud) this.events.push({ t: 'release', p: i, cow: k });
  }

  /** The cow the lasso would catch: one of your own, free, in reach and roughly in front (or right next to you). */
  target(i: number): number {
    const p = this.players[i];
    let best = -1;
    let bestScore = Infinity;
    for (let k = 0; k < this.cows.length; k++) {
      const c = this.cows[k];
      if (c.owner !== i || !c.alive || c.penned || c.heldBy >= 0) continue;
      const dx = c.x - p.x;
      const dz = c.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > LASSO_RANGE) continue;
      const cos = d > 1e-6 ? (dx * p.fx + dz * p.fz) / d : 1;
      if (cos < LASSO_COS && d > LASSO_NEAR) continue;
      const score = d * (1 + (1 - cos) * 1.5);
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    }
    return best;
  }

  private aimAll() {
    for (let i = 0; i < this.n; i++) {
      const p = this.players[i];
      p.aim = p.alive && p.hold < 0 && p.throwT <= 0 ? this.target(i) : -1;
    }
  }

  private moveCow(k: number) {
    const c = this.cows[k];
    if (c.heldBy >= 0) {
      // On a rope: a stretched rope tugs the cow towards whoever holds it.
      const p = this.players[c.heldBy];
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      let tx = 0;
      let tz = 0;
      if (d > ROPE_LEN && d > 1e-6) {
        const s = Math.min(COW_DRAG_MAX, (d - ROPE_LEN) * TUG);
        tx = (dx / d) * s;
        tz = (dz / d) * s;
      }
      const k2 = Math.min(1, 10 * DT);
      c.vx += (tx - c.vx) * k2;
      c.vz += (tz - c.vz) * k2;
    } else {
      c.wander -= DT;
      if (c.wander <= 0) this.pickWander(c);
      const s = c.walking ? COW_WALK : 0;
      const k2 = Math.min(1, 4 * DT);
      c.vx += (c.wx * s - c.vx) * k2;
      c.vz += (c.wz * s - c.vz) * k2;
    }
    c.x += c.vx * DT;
    c.z += c.vz * DT;
    const sp = Math.hypot(c.vx, c.vz);
    if (sp > 0.25) {
      const want = Math.atan2(c.vx, c.vz);
      let d = want - c.rot;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      c.rot += d * Math.min(1, DT * (c.heldBy >= 0 ? 8 : 3));
    }
  }

  /** Graze for a bit, or amble off somewhere – back towards the middle if it's drifted to the edge. */
  private pickWander(c: Cow) {
    c.walking = !c.walking && this.rng() < 0.6;
    if (!c.walking) {
      c.wander = 1.5 + this.rng() * 3;
      return;
    }
    c.wander = 1 + this.rng() * 2.2;
    let a = this.rng() * Math.PI * 2;
    let wx = Math.sin(a);
    let wz = Math.cos(a);
    if (c.penned) {
      const pen = this.pens[c.owner];
      wx = pen.x - c.x + (this.rng() - 0.5) * 3;
      wz = pen.z - c.z + (this.rng() - 0.5) * 3;
    } else {
      const band = this.h / 2 - PEN - 1;
      const far = Math.max(Math.abs(c.x) / (this.w / 2 - 3), Math.abs(c.z) / band);
      if (far > 0.75) {
        a = Math.atan2(-c.x, -c.z) + (this.rng() - 0.5) * 1.2;
        wx = Math.sin(a);
        wz = Math.cos(a);
      }
    }
    const l = Math.hypot(wx, wz) || 1;
    c.wx = wx / l;
    c.wz = wz / l;
  }

  /** Soft circles: players shove each other evenly; cows give way to players; cows nudge each other. */
  private collideBodies() {
    const ps = this.players;
    for (let i = 0; i < this.n; i++) {
      const a = ps[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.n; j++) {
        const b = ps[j];
        if (b.alive) this.separate(a, b, PLAYER_R * 2, 0.5);
      }
      for (const c of this.cows) if (c.alive) this.separate(a, c, PLAYER_R + COW_R, 0.75);
    }
    const cs = this.cows;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j];
        if (!b.alive) continue;
        // A cow being led barges through loose ones.
        const wb = a.heldBy >= 0 && b.heldBy < 0 ? 0.85 : b.heldBy >= 0 && a.heldBy < 0 ? 0.15 : 0.5;
        this.separate(a, b, COW_R * 2, wb);
      }
    }
  }

  /** Push two circles apart; `wb` is the share of the push that moves b. */
  private separate(a: { x: number; z: number }, b: { x: number; z: number }, min: number, wb: number) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2);
    const nx = d > 1e-6 ? dx / d : 1;
    const nz = d > 1e-6 ? dz / d : 0;
    const push = min - d;
    a.x -= nx * push * (1 - wb);
    a.z -= nz * push * (1 - wb);
    b.x += nx * push * wb;
    b.z += nz * push * wb;
  }

  /** A rope is a fence for everyone but its holder and its cow: they're pushed back to the side they're on. */
  private ropeFences() {
    for (let j = 0; j < this.n; j++) {
      const h = this.players[j];
      if (!h.alive || h.hold < 0) continue;
      const cow = this.cows[h.hold];
      const rope: Seg = { ax: h.x, az: h.z, bx: cow.x, bz: cow.z };
      for (let i = 0; i < this.n; i++) {
        const o = this.players[i];
        if (i !== j && o.alive && this.pushOff(o, rope, PLAYER_R + ROPE_R, true)) {
          o.vx *= 0.6;
          o.vz *= 0.6;
        }
      }
      for (let k = 0; k < this.cows.length; k++) {
        const c = this.cows[k];
        if (k !== h.hold && c.alive && !c.penned) this.pushOff(c, rope, COW_R + ROPE_R, true);
      }
    }
  }

  /**
   * Push a circle off a segment. With `inner`, the very ends of the segment don't push (they're the
   * holder and the cow, which bump as bodies), so you can walk round the end of a rope.
   */
  private pushOff(o: { x: number; z: number }, s: Seg, r: number, inner = false) {
    const [cx, cz, t] = closest(s, o.x, o.z);
    if (inner && (t <= 0 || t >= 1)) return false;
    const dx = o.x - cx;
    const dz = o.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    let nx: number;
    let nz: number;
    if (d > 1e-6) {
      nx = dx / d;
      nz = dz / d;
    } else {
      // Right on the line: push out sideways.
      const sx = s.bx - s.ax;
      const sz = s.bz - s.az;
      const l = Math.hypot(sx, sz) || 1;
      nx = -sz / l;
      nz = sx / l;
    }
    o.x = cx + nx * r;
    o.z = cz + nz * r;
    return true;
  }

  /** Fences: the meadow's edge and the pens. Only a cow led into its own pen gets through a gate. */
  private walls() {
    for (const p of this.players) {
      if (!p.alive) continue;
      for (const pen of this.pens) for (const s of pen.walls) this.pushOff(p, s, PLAYER_R);
      this.clampField(p, PLAYER_R);
    }
    for (const c of this.cows) {
      if (!c.alive) continue;
      this.pens.forEach((pen, k) => {
        for (const s of pen.walls) this.pushOff(c, s, COW_R);
        const through = c.heldBy >= 0 && c.owner === k && !c.penned;
        if (!through) this.pushOff(c, pen.gate, COW_R);
      });
      this.clampField(c, COW_R);
    }
  }

  private clampField(o: { x: number; z: number }, r: number) {
    o.x = clamp(o.x, -this.w / 2 + r, this.w / 2 - r);
    o.z = clamp(o.z, -this.h / 2 + r, this.h / 2 - r);
  }

  /**
   * The rope can stretch to ROPE_MAX and no further: the cow is hauled in, and if it's stuck (against a
   * fence, say) the holder is held back instead.
   */
  private tetherAll() {
    for (let i = 0; i < this.n; i++) {
      const p = this.players[i];
      if (!p.alive || p.hold < 0) continue;
      const c = this.cows[p.hold];
      for (let pass = 0; pass < 2; pass++) {
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        const d = Math.hypot(dx, dz);
        if (d <= ROPE_MAX) break;
        const ex = (d - ROPE_MAX) / d;
        if (pass === 0) {
          c.x += dx * ex;
          c.z += dz * ex;
          this.pens.forEach((pen, k) => {
            for (const s of pen.walls) this.pushOff(c, s, COW_R);
            if (k !== c.owner) this.pushOff(c, pen.gate, COW_R);
          });
          this.clampField(c, COW_R);
        } else {
          p.x -= dx * ex;
          p.z -= dz * ex;
          p.vx *= 0.8;
          p.vz *= 0.8;
        }
      }
    }
  }

  /** A cow led far enough through its own gate is penned: the rope comes off and it stays. */
  private checkPens() {
    this.cows.forEach((c, k) => {
      if (!c.alive || c.penned || c.heldBy < 0) return;
      const pen = this.pens[c.owner];
      const into = (pen.z + pen.dir * (PEN / 2) - c.z) * pen.dir;
      if (into < PEN_DEPTH || Math.abs(c.x - pen.x) > PEN / 2) return;
      const i = c.heldBy;
      const p = this.players[i];
      c.penned = true;
      c.heldBy = -1;
      c.wander = 0.5;
      c.walking = false;
      p.hold = -1;
      p.cd = RELEASE_CD;
      p.penned++;
      this.events.push({ t: 'pen', p: i, cow: k, count: p.penned });
      if (p.penned >= this.cowsEach && this.winner < 0) {
        this.winner = i;
        this.events.push({ t: 'done', p: i });
      }
    });
  }

  private moos() {
    if (this.time < this.nextMoo) return;
    this.nextMoo = this.time + 2.5 + this.rng() * 4;
    const live = this.cows.map((c, k) => (c.alive ? k : -1)).filter((k) => k >= 0);
    if (live.length) this.events.push({ t: 'moo', cow: live[Math.floor(this.rng() * live.length)] });
  }

  /** Cows of player i still out in the meadow (not penned). */
  loose(i: number) {
    return this.cows.filter((c) => c.owner === i && c.alive && !c.penned).length;
  }
}

/** Short text for the phone after a round. */
export function placeText(place: number) {
  return ['', '1st', '2nd', '3rd'][place] ?? `${place}th`;
}

export function howTo(short: boolean): string[] {
  return [
    'Walk up to a cow in your colour and face it',
    'LASSO to catch it · drag it into your pen',
    short ? 'Pen all 6 first – or the most in 75 s' : 'Pen all 6 first – or the most in 90 s · 2 rounds',
  ];
}
