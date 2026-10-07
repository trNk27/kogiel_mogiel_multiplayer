/**
 * Czołgi (Tanks): pure simulation, layouts and scoring. No DOM, no three.js.
 *
 * World units are metres. The arena is 44 × 26 m centred on the origin (x right, z towards the
 * viewer). A heading `h` points along (sin h, cos h), so the stick (x, y) maps to atan2(x, y).
 */
import type { Rng } from '../rng';

export const DT = 1 / 60;
export const TANKS_ROUNDS = 3;
/** Tournament version: a single round. */
export const TANKS_ROUNDS_SHORT = 1;

export const ARENA_W = 44;
export const ARENA_H = 26;
export const HX = ARENA_W / 2;
export const HZ = ARENA_H / 2;

export const TUNING = {
  radius: 0.95,
  speed: 5.4,
  /** Hull turn rate, rad/s. */
  turn: 3.2,
  /** If the wanted direction is further away than this, the hull turns on the spot first. */
  spinAngle: (100 * Math.PI) / 180,
  /** Turret turn rate, rad/s (fast). */
  turretRate: 15,
  accel: 30,
  brake: 70,
  deadzone: 0.15,
  shellSpeed: 22,
  shellRadius: 0.2,
  shellMax: 2,
  shellCool: 0.5,
  muzzle: 1.5,
  mortarRange: 11,
  mortarTime: 1.0,
  mortarSplash: 3,
  mortarCool: 4,
  armour: 3,
  protect: 2,
  roundTime: 90,
  sudden: 20,
  knockShell: 3.2,
  knockMortar: 11,
  knockDecay: 6,
  wreckHalf: 0.8,
  crateHp: 2,
};

export type ObKind = 'wall' | 'hay' | 'well' | 'shed' | 'crate' | 'wreck';

/** An axis-aligned box that blocks tanks and shells. Mortars fly over everything. */
export interface Ob {
  id: number;
  kind: ObKind;
  x: number;
  z: number;
  hx: number;
  hz: number;
  hp: number;
  alive: boolean;
}

export interface TankInput {
  /** Stick, -1..1 (+y is towards the viewer). */
  x: number;
  y: number;
  /** Shell button pressed since last step (count). */
  fire: number;
  /** Mortar button pressed since last step (count). */
  mortar: number;
}

export interface Tank {
  idx: number;
  x: number;
  z: number;
  /** Hull heading. */
  h: number;
  /** Turret heading (absolute, not relative to the hull). */
  t: number;
  speed: number;
  kx: number;
  kz: number;
  armour: number;
  alive: boolean;
  removed: boolean;
  /** Seconds of spawn protection left. */
  protect: number;
  shellCool: number;
  mortarCool: number;
  /** Seconds since last hit, for the white flash. */
  hitAge: number;
  kos: number;
  /** Simulation tick when it was knocked out (Infinity while alive). */
  outTick: number;
  killer: number;
  /** Which kind of weapon landed the last hit. */
  killedBy: 'shell' | 'mortar' | null;
}

export interface Shell {
  id: number;
  owner: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  bounces: number;
  age: number;
}

export interface Mortar {
  id: number;
  owner: number;
  x0: number;
  z0: number;
  tx: number;
  tz: number;
  t: number;
  T: number;
}

export type TankEvent =
  | { e: 'shot'; idx: number; x: number; z: number; h: number }
  | { e: 'bounce'; x: number; z: number }
  | { e: 'pop'; x: number; z: number }
  | { e: 'clash'; x: number; z: number }
  | { e: 'block'; idx: number }
  | { e: 'hit'; idx: number; by: number; kind: 'shell' | 'mortar'; x: number; z: number; armour: number }
  | { e: 'ko'; idx: number; by: number; kind: 'shell' | 'mortar'; x: number; z: number }
  | { e: 'crateHit'; id: number; x: number; z: number }
  | { e: 'crate'; id: number; x: number; z: number }
  | { e: 'lob'; idx: number; id: number; tx: number; tz: number }
  | { e: 'splash'; x: number; z: number; owner: number }
  | { e: 'over'; winner: number; timeout: boolean };

// ---------------------------------------------------------------------------
// small geometry helpers
// ---------------------------------------------------------------------------

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Shortest signed angle from a to b. */
export function angDiff(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function turnToward(a: number, b: number, maxStep: number) {
  const d = angDiff(a, b);
  return a + clamp(d, -maxStep, maxStep);
}

export interface Push {
  nx: number;
  nz: number;
  pen: number;
}

/** Circle against box: the normal pointing out of the box and how deep the circle is in it. */
export function circleBox(cx: number, cz: number, r: number, b: { x: number; z: number; hx: number; hz: number }): Push | null {
  const qx = clamp(cx, b.x - b.hx, b.x + b.hx);
  const qz = clamp(cz, b.z - b.hz, b.z + b.hz);
  const dx = cx - qx;
  const dz = cz - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, nz: dz / d, pen: r - d };
  }
  // Centre inside the box: leave by the nearest face.
  const l = cx - (b.x - b.hx);
  const rt = b.x + b.hx - cx;
  const t = cz - (b.z - b.hz);
  const bt = b.z + b.hz - cz;
  const m = Math.min(l, rt, t, bt);
  if (m === l) return { nx: -1, nz: 0, pen: l + r };
  if (m === rt) return { nx: 1, nz: 0, pen: rt + r };
  if (m === t) return { nx: 0, nz: -1, pen: t + r };
  return { nx: 0, nz: 1, pen: bt + r };
}

/** The gap between two boxes along the more open axis (0 when they touch or overlap). */
export function boxGap(a: { x: number; z: number; hx: number; hz: number }, b: { x: number; z: number; hx: number; hz: number }) {
  const gx = Math.abs(a.x - b.x) - (a.hx + b.hx);
  const gz = Math.abs(a.z - b.z) - (a.hz + b.hz);
  return Math.max(0, gx, gz);
}

// ---------------------------------------------------------------------------
// layouts
// ---------------------------------------------------------------------------

type Proto = [kind: ObKind, x: number, z: number, hx: number, hz: number];

export interface Template {
  name: string;
  /** One quarter's worth of obstacles; mirrored into all four quarters. */
  quarter: Proto[];
}

export const TEMPLATES: Template[] = [
  {
    name: 'Farmyard',
    quarter: [
      ['well', 0, 0, 1.2, 1.2],
      ['hay', 7, 3.6, 1.4, 1.1],
      ['wall', 12.6, 0, 0.45, 3],
      ['wall', 0, 7.8, 3, 0.45],
    ],
  },
  {
    name: 'Village square',
    quarter: [
      ['shed', 0, 0, 3, 2],
      ['hay', 8.6, 5.6, 1.1, 1.1],
      ['wall', 14, 5, 0.45, 2.5],
      ['well', 8.2, 0, 1, 1],
    ],
  },
  {
    name: 'Crossroads',
    quarter: [
      ['wall', 6.6, 3.2, 3.5, 0.45],
      ['wall', 14, 0, 0.45, 4],
      ['hay', 0, 5.8, 1.8, 1],
      ['well', 10.6, 6.6, 1, 1],
    ],
  },
  {
    name: 'Fence rows',
    quarter: [
      ['wall', 5.6, 5.2, 0.45, 3.5],
      ['wall', 11.6, 0.4, 0.45, 3],
      ['hay', 14.4, 6.6, 1.1, 1.1],
      ['well', 0, 0, 1.1, 1.1],
    ],
  },
  {
    name: 'Hay field',
    quarter: [
      ['hay', 4.2, 2.2, 1.2, 1.2],
      ['hay', 10, 6, 1.2, 1.2],
      ['hay', 14.4, 1.6, 1.2, 1.2],
      ['hay', 0, 6.6, 1.2, 1.2],
      ['shed', 8.8, 0, 1.4, 1],
      ['well', 15, 6.6, 0.9, 0.9],
    ],
  },
];

function mirrored(protos: Proto[]): Proto[] {
  const out: Proto[] = [];
  const seen = new Set<string>();
  for (const [k, x, z, hx, hz] of protos)
    for (const sx of [1, -1])
      for (const sz of [1, -1]) {
        const p: Proto = [k, x * sx, z * sz, hx, hz];
        const key = `${k}${p[1].toFixed(2)},${p[2].toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(p);
      }
  return out;
}

export interface Layout {
  template: number;
  name: string;
  obstacles: Ob[];
}

export const CRATE_HALF = 0.8;
const CRATE_STEP = CRATE_HALF * 2;
/** Crates keep at least this much room (m) from other things, so a tank can always squeeze past. */
const MIN_SLOT = 2.15;

function makeOb(id: number, [kind, x, z, hx, hz]: Proto): Ob {
  return { id, kind, x, z, hx, hz, hp: kind === 'crate' ? TUNING.crateHp : 99, alive: true };
}

/** Static obstacles of a template, no crates. */
export function staticObstacles(template: number): Ob[] {
  return mirrored(TEMPLATES[template % TEMPLATES.length].quarter).map((p, i) => makeOb(i, p));
}

/**
 * Evenly spaced spawn points around the arena edge, each facing the centre. For an even number of
 * tanks the set is point-symmetric. Slot 0 is just right of the top-left corner.
 */
export function spawnPoints(n: number): { x: number; z: number; h: number }[] {
  const inset = 2.3;
  const w = ARENA_W - inset * 2;
  const d = ARENA_H - inset * 2;
  const per = (w + d) * 2;
  const out: { x: number; z: number; h: number }[] = [];
  for (let k = 0; k < n; k++) {
    let s = ((k + 0.5) * per) / n;
    let x: number;
    let z: number;
    if (s < w) {
      x = -w / 2 + s;
      z = -d / 2;
    } else if ((s -= w) < d) {
      x = w / 2;
      z = -d / 2 + s;
    } else if ((s -= d) < w) {
      x = w / 2 - s;
      z = d / 2;
    } else {
      s -= w;
      x = -w / 2;
      z = d / 2 - s;
    }
    out.push({ x, z, h: Math.atan2(-x, -z) });
  }
  return out;
}

const CELL = 0.5;

/**
 * Can a tank get from every spawn to every other open area? Flood-fills the floor on a grid with
 * the tank's radius taken off, counting the crates (and everything else) as solid.
 */
export function isConnected(obstacles: Ob[], spawns: { x: number; z: number }[]): boolean {
  const r = TUNING.radius + 0.05;
  const cols = Math.round(ARENA_W / CELL);
  const rows = Math.round(ARENA_H / CELL);
  const solid = obstacles.filter((o) => o.alive);
  const free = new Uint8Array(cols * rows);
  let total = 0;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = -HX + (i + 0.5) * CELL;
      const z = -HZ + (j + 0.5) * CELL;
      if (Math.abs(x) > HX - r || Math.abs(z) > HZ - r) continue;
      if (solid.some((o) => circleBox(x, z, r, o))) continue;
      free[j * cols + i] = 1;
      total++;
    }
  const cell = (p: { x: number; z: number }) => {
    const i = clamp(Math.floor((p.x + HX) / CELL), 0, cols - 1);
    const j = clamp(Math.floor((p.z + HZ) / CELL), 0, rows - 1);
    return j * cols + i;
  };
  const start = spawns.length ? cell(spawns[0]) : cell({ x: 0, z: 0 });
  if (!free[start]) return false;
  const seen = new Uint8Array(cols * rows);
  const stack = [start];
  seen[start] = 1;
  let n = 0;
  while (stack.length) {
    const c = stack.pop()!;
    n++;
    const i = c % cols;
    const j = (c - i) / cols;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nc = nj * cols + ni;
      if (free[nc] && !seen[nc]) {
        seen[nc] = 1;
        stack.push(nc);
      }
    }
  }
  if (!spawns.every((s) => seen[cell(s)])) return false;
  return n >= total * 0.985;
}

/**
 * A random layout: a template plus randomly placed (point-symmetric) crates. Crates sit on a
 * 1.6 m grid so they stack neatly, and never leave an area that a tank can't get into.
 */
export function makeLayout(rng: Rng, template?: number, maxCrates = 14): Layout {
  const ti = template ?? Math.floor(rng() * TEMPLATES.length);
  const base = staticObstacles(ti);
  const spawns = spawnPoints(8);
  const nextId = base.length;
  for (let attempt = 0; attempt < 12; attempt++) {
    const crates: Ob[] = [];
    const want = Math.min(maxCrates, 10 + Math.floor(rng() * 5));
    const ok = (c: Ob, others: Ob[]) => {
      if (Math.abs(c.x) > 16.2 || Math.abs(c.z) > 8.1) return false;
      for (const o of base) if (boxGap(c, o) < MIN_SLOT) return false;
      for (const o of others) {
        if (Math.abs(c.x - o.x) < 0.01 && Math.abs(c.z - o.z) < 0.01) return false;
        // Touching crates stack neatly; a slot a tank can't fit through is not allowed.
        const g = boxGap(c, o);
        if (g > 0.01 && g < MIN_SLOT) return false;
      }
      return true;
    };
    let guard = 0;
    while (crates.length < want && guard++ < 900) {
      const gx = Math.round((rng() * 2 - 1) * 10);
      const gz = Math.round((rng() * 2 - 1) * 5);
      const a: Ob = { id: 0, kind: 'crate', x: gx * CRATE_STEP, z: gz * CRATE_STEP, hx: CRATE_HALF, hz: CRATE_HALF, hp: TUNING.crateHp, alive: true };
      if (!ok(a, crates)) continue;
      if (a.x === 0 && a.z === 0) {
        crates.push(a);
        continue;
      }
      const b: Ob = { ...a, x: -a.x, z: -a.z };
      // The mirror image must fit beside the new crate too.
      if (!ok(b, [...crates, a])) continue;
      crates.push(a, b);
    }
    const all = [...base, ...crates.map((c, i) => ({ ...c, id: nextId + i }))];
    if (isConnected(all, spawns)) return { template: ti, name: TEMPLATES[ti].name, obstacles: all };
  }
  return { template: ti, name: TEMPLATES[ti].name, obstacles: base };
}

// ---------------------------------------------------------------------------
// the simulation
// ---------------------------------------------------------------------------

export interface SimOptions {
  /** Which tanks are in the game (false = not there at all). */
  present?: boolean[];
  layout?: Layout;
  /** Shuffle the spawn slots between players (default true). */
  shuffle?: boolean;
}

export class TanksSim {
  readonly n: number;
  readonly layout: Layout;
  tanks: Tank[] = [];
  obstacles: Ob[];
  shells: Shell[] = [];
  mortars: Mortar[] = [];
  tick = 0;
  /** Seconds of the round left. Only runs once `locked` is off. */
  timeLeft = TUNING.roundTime;
  /** Ready phase: tanks can drive and aim but not shoot, and the clock and shields are waiting. */
  locked = true;
  over = false;
  winner = -1;
  timedOut = false;
  /** Number of tanks that were in the round to begin with. */
  readonly started: number;
  private nextId = 1000;
  private events: TankEvent[] = [];

  constructor(n: number, rng: Rng, opts: SimOptions = {}) {
    this.n = n;
    this.layout = opts.layout ?? makeLayout(rng);
    this.obstacles = this.layout.obstacles.map((o) => ({ ...o }));
    const present = opts.present ?? Array.from({ length: n }, () => true);
    const seats = present.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    this.started = seats.length;
    const spots = spawnPoints(Math.max(1, seats.length));
    if (opts.shuffle !== false) for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    for (let i = 0; i < n; i++) {
      const k = seats.indexOf(i);
      const sp = k >= 0 ? spots[k] : { x: 0, z: 0, h: 0 };
      this.tanks.push({
        idx: i,
        x: sp.x,
        z: sp.z,
        h: sp.h,
        t: sp.h,
        speed: 0,
        kx: 0,
        kz: 0,
        armour: TUNING.armour,
        alive: k >= 0,
        removed: k < 0,
        protect: TUNING.protect,
        shellCool: 0,
        mortarCool: 0,
        hitAge: 9,
        kos: 0,
        outTick: Infinity,
        killer: -1,
        killedBy: null,
      });
    }
  }

  get suddenDeath() {
    return !this.locked && this.timeLeft <= TUNING.sudden;
  }

  aliveCount() {
    return this.tanks.filter((t) => t.alive).length;
  }

  /** A player left the game (kicked): they vanish and don't count for anything. */
  remove(idx: number) {
    const t = this.tanks[idx];
    if (!t || t.removed) return;
    t.removed = true;
    t.alive = false;
    this.checkEnd();
  }

  crateAt(id: number) {
    return this.obstacles.find((o) => o.id === id);
  }

  /** How many shells of this tank are flying. */
  shellsOf(idx: number) {
    return this.shells.filter((s) => s.owner === idx).length;
  }

  /** Where a mortar fired from this tank right now would land. */
  mortarTarget(t: Tank) {
    return {
      x: clamp(t.x + Math.sin(t.t) * TUNING.mortarRange, -HX + 0.8, HX - 0.8),
      z: clamp(t.z + Math.cos(t.t) * TUNING.mortarRange, -HZ + 0.8, HZ - 0.8),
    };
  }

  step(inputs: TankInput[]): TankEvent[] {
    this.events = [];
    if (this.over) return this.events;
    this.tick++;
    if (!this.locked) {
      this.timeLeft = Math.max(0, this.timeLeft - DT);
    }
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const input = inputs[t.idx] ?? { x: 0, y: 0, fire: 0, mortar: 0 };
      this.driveTank(t, input);
      t.hitAge += DT;
      if (!this.locked) {
        t.protect = Math.max(0, t.protect - DT);
        t.shellCool = Math.max(0, t.shellCool - DT);
        t.mortarCool = Math.max(0, t.mortarCool - DT);
        if (input.fire > 0) this.fireShell(t);
        if (input.mortar > 0) this.fireMortar(t);
      }
    }
    this.separateTanks();
    this.stepShells();
    this.stepMortars();
    this.checkEnd();
    return this.events;
  }

  private driveTank(t: Tank, input: TankInput) {
    const m = Math.min(1, Math.hypot(input.x, input.y));
    if (m > TUNING.deadzone) {
      const want = Math.atan2(input.x, input.y);
      t.t = turnToward(t.t, want, TUNING.turretRate * DT);
      const diff = angDiff(t.h, want);
      t.h += clamp(diff, -TUNING.turn * DT, TUNING.turn * DT);
      const ad = Math.abs(diff);
      const target = ad > TUNING.spinAngle ? 0 : m * TUNING.speed * (1 - 0.45 * (ad / TUNING.spinAngle));
      t.speed += clamp(target - t.speed, -TUNING.brake * DT, TUNING.accel * DT);
    } else {
      t.speed = Math.max(0, t.speed - TUNING.brake * DT);
    }
    t.x += (Math.sin(t.h) * t.speed + t.kx) * DT;
    t.z += (Math.cos(t.h) * t.speed + t.kz) * DT;
    const decay = Math.exp(-TUNING.knockDecay * DT);
    t.kx *= decay;
    t.kz *= decay;
    this.collideTank(t);
  }

  private collideTank(t: Tank) {
    const r = TUNING.radius;
    for (let pass = 0; pass < 3; pass++) {
      t.x = clamp(t.x, -HX + r, HX - r);
      t.z = clamp(t.z, -HZ + r, HZ - r);
      for (const o of this.obstacles) {
        if (!o.alive) continue;
        const p = circleBox(t.x, t.z, r, o);
        if (!p) continue;
        t.x += p.nx * p.pen;
        t.z += p.nz * p.pen;
        // Slide: remove the part of the knockback that points into the box.
        const vn = t.kx * p.nx + t.kz * p.nz;
        if (vn < 0) {
          t.kx -= vn * p.nx;
          t.kz -= vn * p.nz;
        }
      }
    }
  }

  private separateTanks() {
    const min = TUNING.radius * 1.9;
    for (let a = 0; a < this.tanks.length; a++) {
      const A = this.tanks[a];
      if (!A.alive) continue;
      for (let b = a + 1; b < this.tanks.length; b++) {
        const B = this.tanks[b];
        if (!B.alive) continue;
        const dx = B.x - A.x;
        const dz = B.z - A.z;
        const d = Math.hypot(dx, dz);
        if (d >= min) continue;
        const nx = d > 1e-6 ? dx / d : 1;
        const nz = d > 1e-6 ? dz / d : 0;
        const push = (min - d) / 2;
        A.x -= nx * push;
        A.z -= nz * push;
        B.x += nx * push;
        B.z += nz * push;
        this.collideTank(A);
        this.collideTank(B);
      }
    }
  }

  fireShell(t: Tank) {
    if (t.shellCool > 0 || this.shellsOf(t.idx) >= TUNING.shellMax) return false;
    t.shellCool = TUNING.shellCool;
    const dx = Math.sin(t.t);
    const dz = Math.cos(t.t);
    this.shells.push({
      id: this.nextId++,
      owner: t.idx,
      x: t.x + dx * TUNING.muzzle,
      z: t.z + dz * TUNING.muzzle,
      vx: dx * TUNING.shellSpeed,
      vz: dz * TUNING.shellSpeed,
      bounces: 0,
      age: 0,
    });
    this.events.push({ e: 'shot', idx: t.idx, x: t.x + dx * TUNING.muzzle, z: t.z + dz * TUNING.muzzle, h: t.t });
    return true;
  }

  fireMortar(t: Tank) {
    if (t.mortarCool > 0) return false;
    t.mortarCool = TUNING.mortarCool;
    const tg = this.mortarTarget(t);
    const m: Mortar = { id: this.nextId++, owner: t.idx, x0: t.x, z0: t.z, tx: tg.x, tz: tg.z, t: 0, T: TUNING.mortarTime };
    this.mortars.push(m);
    this.events.push({ e: 'lob', idx: t.idx, id: m.id, tx: tg.x, tz: tg.z });
    return true;
  }

  /** Hurt a tank. Returns true if it took damage. */
  hurt(t: Tank, by: number, kind: 'shell' | 'mortar', dirx: number, dirz: number): boolean {
    if (!t.alive || this.over) return false;
    if (t.protect > 0) {
      this.events.push({ e: 'block', idx: t.idx });
      return false;
    }
    t.armour = this.suddenDeath ? 0 : t.armour - 1;
    t.hitAge = 0;
    t.killer = by;
    t.killedBy = kind;
    const k = kind === 'mortar' ? TUNING.knockMortar : TUNING.knockShell;
    t.kx += dirx * k;
    t.kz += dirz * k;
    if (t.armour <= 0) {
      t.armour = 0;
      t.alive = false;
      t.outTick = this.tick;
      t.speed = 0;
      const killer = this.tanks[by];
      if (killer && by !== t.idx) killer.kos++;
      this.obstacles.push({ id: this.nextId++, kind: 'wreck', x: t.x, z: t.z, hx: TUNING.wreckHalf, hz: TUNING.wreckHalf, hp: 99, alive: true });
      this.events.push({ e: 'ko', idx: t.idx, by, kind, x: t.x, z: t.z });
    } else this.events.push({ e: 'hit', idx: t.idx, by, kind, x: t.x, z: t.z, armour: t.armour });
    return true;
  }

  private hitCrate(o: Ob, dmg: number) {
    if (o.kind !== 'crate' || !o.alive) return;
    o.hp -= dmg;
    if (o.hp <= 0) {
      o.alive = false;
      this.events.push({ e: 'crate', id: o.id, x: o.x, z: o.z });
    } else this.events.push({ e: 'crateHit', id: o.id, x: o.x, z: o.z });
  }

  private stepShells() {
    const r = TUNING.shellRadius;
    const keep: Shell[] = [];
    const dead = new Set<number>();
    const SUB = 2;
    for (const s of this.shells) {
      let popped = false;
      s.age += DT;
      for (let k = 0; k < SUB && !popped; k++) {
        s.x += (s.vx * DT) / SUB;
        s.z += (s.vz * DT) / SUB;
        // contacts with the arena edge and obstacles
        const contacts: { nx: number; nz: number; pen: number; ob?: Ob }[] = [];
        if (s.x - r < -HX) contacts.push({ nx: 1, nz: 0, pen: -HX - (s.x - r) });
        if (s.x + r > HX) contacts.push({ nx: -1, nz: 0, pen: s.x + r - HX });
        if (s.z - r < -HZ) contacts.push({ nx: 0, nz: 1, pen: -HZ - (s.z - r) });
        if (s.z + r > HZ) contacts.push({ nx: 0, nz: -1, pen: s.z + r - HZ });
        for (const o of this.obstacles) {
          if (!o.alive) continue;
          const p = circleBox(s.x, s.z, r, o);
          if (p) contacts.push({ ...p, ob: o });
        }
        for (const c of contacts) {
          const vn = s.vx * c.nx + s.vz * c.nz;
          if (vn >= 0) continue;
          s.x += c.nx * c.pen;
          s.z += c.nz * c.pen;
          if (c.ob) this.hitCrate(c.ob, 1);
          if (s.bounces >= 1) {
            this.events.push({ e: 'pop', x: s.x, z: s.z });
            popped = true;
            break;
          }
          s.bounces++;
          s.vx -= 2 * vn * c.nx;
          s.vz -= 2 * vn * c.nz;
          this.events.push({ e: 'bounce', x: s.x, z: s.z });
        }
        if (popped) break;
        // tanks
        for (const t of this.tanks) {
          if (!t.alive) continue;
          if (t.idx === s.owner && s.bounces === 0) continue;
          const d = Math.hypot(t.x - s.x, t.z - s.z);
          if (d > TUNING.radius + r * 0.5) continue;
          const sp = Math.hypot(s.vx, s.vz) || 1;
          this.hurt(t, s.owner, 'shell', s.vx / sp, s.vz / sp);
          this.events.push({ e: 'pop', x: s.x, z: s.z });
          popped = true;
          break;
        }
      }
      if (popped) dead.add(s.id);
      else keep.push(s);
    }
    // shells meeting shells pop each other
    for (let a = 0; a < keep.length; a++)
      for (let b = a + 1; b < keep.length; b++) {
        const A = keep[a];
        const B = keep[b];
        if (dead.has(A.id) || dead.has(B.id)) continue;
        if (Math.hypot(A.x - B.x, A.z - B.z) < r * 2.6) {
          dead.add(A.id);
          dead.add(B.id);
          this.events.push({ e: 'clash', x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 });
        }
      }
    this.shells = keep.filter((s) => !dead.has(s.id));
  }

  private stepMortars() {
    const left: Mortar[] = [];
    for (const m of this.mortars) {
      m.t += DT;
      if (m.t < m.T) {
        left.push(m);
        continue;
      }
      this.events.push({ e: 'splash', x: m.tx, z: m.tz, owner: m.owner });
      const R = TUNING.mortarSplash;
      for (const o of this.obstacles) {
        if (o.kind !== 'crate' || !o.alive) continue;
        if (circleBox(m.tx, m.tz, R, o)) this.hitCrate(o, 99);
      }
      for (const t of this.tanks) {
        if (!t.alive) continue;
        const dx = t.x - m.tx;
        const dz = t.z - m.tz;
        const d = Math.hypot(dx, dz);
        if (d > R) continue;
        const nx = d > 1e-3 ? dx / d : Math.sin(t.t);
        const nz = d > 1e-3 ? dz / d : Math.cos(t.t);
        this.hurt(t, m.owner, 'mortar', nx, nz);
      }
    }
    this.mortars = left;
  }

  private checkEnd() {
    if (this.over || this.started < 2) return;
    const alive = this.tanks.filter((t) => t.alive);
    if (alive.length <= 1) {
      this.over = true;
      this.winner = alive.length === 1 ? alive[0].idx : -1;
    } else if (!this.locked && this.timeLeft <= 0) {
      this.over = true;
      this.timedOut = true;
      this.winner = -1;
    }
    if (this.over) {
      // Nothing is left in the air once the round is decided.
      this.shells = [];
      this.mortars = [];
      this.events.push({ e: 'over', winner: this.winner, timeout: this.timedOut });
    }
  }
}

// ---------------------------------------------------------------------------
// scoring
// ---------------------------------------------------------------------------

export interface RoundPoints {
  /** Total points this round per tank index (0 for tanks that weren't there). */
  total: number[];
  kos: number[];
  survival: number[];
  bonus: number[];
}

export const WINNER_BONUS = 2;

/**
 * +1 per tank you knocked out (last hit), plus one point for every tank that was knocked out before
 * you (still-rolling tanks count them all), plus 2 for being the last tank standing.
 */
export function roundPoints(tanks: Pick<Tank, 'alive' | 'removed' | 'outTick' | 'kos'>[]): RoundPoints {
  const inRound = tanks.filter((t) => !t.removed);
  const out: RoundPoints = { total: [], kos: [], survival: [], bonus: [] };
  const alive = inRound.filter((t) => t.alive);
  const lone = inRound.length >= 2 && alive.length === 1 ? alive[0] : null;
  for (const t of tanks) {
    if (t.removed) {
      out.total.push(0);
      out.kos.push(0);
      out.survival.push(0);
      out.bonus.push(0);
      continue;
    }
    const surv = inRound.filter((o) => !o.alive && o.outTick < (t.alive ? Infinity : t.outTick)).length;
    const bonus = t === lone ? WINNER_BONUS : 0;
    out.kos.push(t.kos);
    out.survival.push(surv);
    out.bonus.push(bonus);
    out.total.push(t.kos + surv + bonus);
  }
  return out;
}

export function armourHearts(armour: number, max = TUNING.armour) {
  return '♥'.repeat(Math.max(0, armour)) + '♡'.repeat(Math.max(0, max - armour));
}

export function howTo(short: boolean): string[] {
  return [
    'Push the stick to drive and aim: your tank turns towards it and the turret follows. Let go to stop.',
    'Shell bounces once off walls and pops on the second hit. Mortar lobs a cabbage over everything onto the red ring.',
    short
      ? 'Three hits and you’re scrap. One round of 90 seconds: knock tanks out and outlast them.'
      : `Three hits and you’re scrap. ${TANKS_ROUNDS} rounds of 90 seconds: points for knock-outs and for outlasting, +2 for the last tank rolling.`,
  ];
}
