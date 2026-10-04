/**
 * Trails simulation – pure logic, no DOM. Runs at a fixed 60 Hz timestep.
 * Collision uses an occupancy grid with one cell per world unit.
 */

export const WORLD_W = 800;
export const WORLD_H = 480;
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

export interface TrailsTuning {
  /** Line speed in world units per second. */
  speed: number;
  /** Turning speed in radians per second. */
  turnRate: number;
  /** Half the line width, in world units. */
  radius: number;
  /** Seconds between gaps (random in [gapMin, gapMax]). */
  gapMin: number;
  gapMax: number;
  /** Length of a gap in world units. */
  gapLength: number;
  /** Seconds after "GO" during which a line is a harmless ghost (no trail, no collisions). */
  ghostTime: number;
}

/** Tuned for a sofa: a full lap of the arena takes ~10 s, a full circle ~1.9 s. */
export const TUNING: TrailsTuning = {
  speed: 88,
  turnRate: 3.4,
  radius: 2.5,
  gapMin: 1.6,
  gapMax: 3.4,
  gapLength: 15,
  ghostTime: 0.55,
};

export type PowerKind = 'speed' | 'slow' | 'thin' | 'wrap';
export const POWER_KINDS: PowerKind[] = ['speed', 'slow', 'thin', 'wrap'];
export const POWER_SECONDS: Record<PowerKind, number> = { speed: 4, slow: 4, thin: 6, wrap: 6 };
const POWER_RADIUS = 9;
const MAX_POWERUPS = 3;

export interface PowerUp {
  id: number;
  kind: PowerKind;
  x: number;
  y: number;
}

export interface Snake {
  idx: number;
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  /** -1 = left, 0 = straight, 1 = right. */
  turn: -1 | 0 | 1;
  gapTicks: number;
  nextGapTicks: number;
  ghostTicks: number;
  /** Remaining ticks of each effect. `slow` means "slowed by someone else". */
  fx: Record<PowerKind, number>;
}

export interface Segment {
  idx: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
}

export interface StepEvents {
  deaths: number[];
  segments: Segment[];
  pickups: { idx: number; kind: PowerKind }[];
}

import type { Rng } from '../rng';
export { mulberry32, type Rng } from '../rng';

/** Occupancy grid. `owner` is 0 for empty, otherwise snake index + 1. */
export class Grid {
  readonly owner: Uint8Array;
  readonly tick: Int32Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.owner = new Uint8Array(w * h);
    this.tick = new Int32Array(w * h);
  }

  clear() {
    this.owner.fill(0);
    this.tick.fill(0);
  }

  /** Fill a disc. With `wrap`, cells outside the grid wrap around. */
  paint(x: number, y: number, r: number, owner: number, tick: number, wrap = false) {
    const r2 = r * r;
    const x0 = Math.floor(x - r);
    const x1 = Math.ceil(x + r);
    const y0 = Math.floor(y - r);
    const y1 = Math.ceil(y + r);
    for (let j = y0; j <= y1; j++) {
      const dy = j + 0.5 - y;
      for (let i = x0; i <= x1; i++) {
        const dx = i + 0.5 - x;
        if (dx * dx + dy * dy > r2) continue;
        let ci = i;
        let cj = j;
        if (wrap) {
          ci = ((i % this.w) + this.w) % this.w;
          cj = ((j % this.h) + this.h) % this.h;
        } else if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
        const k = cj * this.w + ci;
        this.owner[k] = owner;
        this.tick[k] = tick;
      }
    }
  }

  /**
   * Is the cell at (x, y) deadly for `self`? Other players' cells always are; your own only
   * once they are older than `selfGrace` ticks (so your fresh trail doesn't kill you).
   */
  hits(x: number, y: number, self: number, now: number, selfGrace: number, wrap = false): boolean {
    let i = Math.floor(x);
    let j = Math.floor(y);
    if (wrap) {
      i = ((i % this.w) + this.w) % this.w;
      j = ((j % this.h) + this.h) % this.h;
    } else if (i < 0 || j < 0 || i >= this.w || j >= this.h) return true;
    const k = j * this.w + i;
    const o = this.owner[k];
    if (o === 0) return false;
    if (o !== self) return true;
    return now - this.tick[k] > selfGrace;
  }
}

/** Probe directions on the front arc of the head (radians relative to heading). */
const PROBES = [-1.0, -0.5, 0, 0.5, 1.0];

export interface SimOptions {
  rng?: Rng;
  tuning?: TrailsTuning;
  powerups?: boolean;
  w?: number;
  h?: number;
}

export class TrailsSim {
  readonly w: number;
  readonly h: number;
  readonly grid: Grid;
  readonly snakes: Snake[] = [];
  readonly tuning: TrailsTuning;
  powerups: PowerUp[] = [];
  tick = 0;
  private rng: Rng;
  private powerupsOn: boolean;
  private nextPowerTick = 0;
  private powerSeq = 0;

  constructor(players: number, opts: SimOptions = {}) {
    this.w = opts.w ?? WORLD_W;
    this.h = opts.h ?? WORLD_H;
    this.rng = opts.rng ?? Math.random;
    this.tuning = opts.tuning ?? TUNING;
    this.powerupsOn = !!opts.powerups;
    this.grid = new Grid(this.w, this.h);
    this.spawn(players);
    this.nextPowerTick = this.randTicks(3, 6);
  }

  private randTicks(minS: number, maxS: number) {
    return Math.round((minS + this.rng() * (maxS - minS)) * TICK_HZ);
  }

  private spawn(n: number) {
    const margin = Math.min(80, this.w / 5, this.h / 5);
    const spots: { x: number; y: number }[] = [];
    for (let idx = 0; idx < n; idx++) {
      let best = { x: this.w / 2, y: this.h / 2 };
      let bestDist = -1;
      for (let attempt = 0; attempt < 40; attempt++) {
        const c = { x: margin + this.rng() * (this.w - 2 * margin), y: margin + this.rng() * (this.h - 2 * margin) };
        const d = spots.reduce((m, s) => Math.min(m, Math.hypot(s.x - c.x, s.y - c.y)), Infinity);
        if (d > bestDist) {
          best = c;
          bestDist = d;
        }
        if (d > 110) break;
      }
      spots.push(best);
      // Face roughly towards the centre so nobody starts by staring at a wall.
      const toCentre = Math.atan2(this.h / 2 - best.y, this.w / 2 - best.x);
      const angle = toCentre + (this.rng() - 0.5) * Math.PI;
      this.snakes.push({
        idx,
        x: best.x,
        y: best.y,
        angle,
        alive: true,
        turn: 0,
        gapTicks: 0,
        nextGapTicks: this.randTicks(this.tuning.gapMin, this.tuning.gapMax),
        ghostTicks: Math.round(this.tuning.ghostTime * TICK_HZ),
        fx: { speed: 0, slow: 0, thin: 0, wrap: 0 },
      });
    }
  }

  setTurn(idx: number, turn: -1 | 0 | 1) {
    const s = this.snakes[idx];
    if (s) s.turn = turn;
  }

  kill(idx: number) {
    const s = this.snakes[idx];
    if (s) s.alive = false;
  }

  aliveCount() {
    return this.snakes.filter((s) => s.alive).length;
  }

  speedOf(s: Snake) {
    let v = this.tuning.speed;
    if (s.fx.speed > 0) v *= 1.6;
    if (s.fx.slow > 0) v *= 0.6;
    return v;
  }

  radiusOf(s: Snake) {
    return s.fx.thin > 0 ? this.tuning.radius * 0.5 : this.tuning.radius;
  }

  step(): StepEvents {
    this.tick++;
    const ev: StepEvents = { deaths: [], segments: [], pickups: [] };
    const paints: { x: number; y: number; r: number; owner: number; wrap: boolean }[] = [];

    for (const s of this.snakes) {
      if (!s.alive) continue;
      const v = this.speedOf(s);
      const r = this.radiusOf(s);
      const wrap = s.fx.wrap > 0;
      const ghost = s.ghostTicks > 0;
      s.angle += s.turn * this.tuning.turnRate * DT;

      // Gap bookkeeping
      if (!ghost) {
        if (s.gapTicks > 0) s.gapTicks--;
        else if (--s.nextGapTicks <= 0) {
          s.gapTicks = Math.max(1, Math.round((this.tuning.gapLength / v) * TICK_HZ));
          s.nextGapTicks = this.randTicks(this.tuning.gapMin, this.tuning.gapMax);
        }
      }
      const drawing = !ghost && s.gapTicks === 0;

      // Move in sub-steps of at most 1 unit so fast lines can't tunnel through thin ones.
      const dist = v * DT;
      const subs = Math.max(1, Math.ceil(dist));
      const dx = (Math.cos(s.angle) * dist) / subs;
      const dy = (Math.sin(s.angle) * dist) / subs;
      // Own cells younger than this many ticks are safe (we just painted them).
      const grace = Math.ceil((2 * this.tuning.radius + 3) / Math.max(0.3, dist)) + 1;

      for (let k = 0; k < subs && s.alive; k++) {
        const px = s.x;
        const py = s.y;
        s.x += dx;
        s.y += dy;
        let wrapped = false;
        if (wrap) {
          if (s.x < 0 || s.x >= this.w || s.y < 0 || s.y >= this.h) {
            s.x = (s.x + this.w) % this.w;
            s.y = (s.y + this.h) % this.h;
            wrapped = true;
          }
        } else if (!ghost && (s.x < r || s.y < r || s.x > this.w - r || s.y > this.h - r)) {
          s.alive = false;
          break;
        } else if (ghost) {
          // Ghosts bounce off walls instead of dying.
          if (s.x < r || s.x > this.w - r) s.angle = Math.PI - s.angle;
          if (s.y < r || s.y > this.h - r) s.angle = -s.angle;
          s.x = Math.min(this.w - r, Math.max(r, s.x));
          s.y = Math.min(this.h - r, Math.max(r, s.y));
        }

        if (!ghost) {
          for (const phi of PROBES) {
            const a = s.angle + phi;
            const qx = s.x + Math.cos(a) * (r + 0.6);
            const qy = s.y + Math.sin(a) * (r + 0.6);
            if (this.grid.hits(qx, qy, s.idx + 1, this.tick, grace, wrap)) {
              s.alive = false;
              break;
            }
          }
        }
        if (drawing) {
          paints.push({ x: s.x, y: s.y, r, owner: s.idx + 1, wrap });
          if (!wrapped) ev.segments.push({ idx: s.idx, x0: px, y0: py, x1: s.x, y1: s.y, r });
        }
      }

      if (!s.alive) ev.deaths.push(s.idx);
      if (s.ghostTicks > 0) s.ghostTicks--;
      for (const kind of POWER_KINDS) if (s.fx[kind] > 0) s.fx[kind]--;
    }

    // Paint after everyone moved, so simultaneous head-on crashes are symmetric.
    for (const p of paints) this.grid.paint(p.x, p.y, p.r, p.owner, this.tick, p.wrap);

    if (this.powerupsOn) this.stepPowerups(ev);
    return ev;
  }

  private stepPowerups(ev: StepEvents) {
    if (this.tick >= this.nextPowerTick) {
      this.nextPowerTick = this.tick + this.randTicks(4, 8);
      if (this.powerups.length < MAX_POWERUPS) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const x = 40 + this.rng() * (this.w - 80);
          const y = 40 + this.rng() * (this.h - 80);
          if (this.grid.owner[Math.floor(y) * this.w + Math.floor(x)] !== 0) continue;
          const kind = POWER_KINDS[Math.floor(this.rng() * POWER_KINDS.length)];
          this.powerups.push({ id: ++this.powerSeq, kind, x, y });
          break;
        }
      }
    }
    for (const s of this.snakes) {
      if (!s.alive || s.ghostTicks > 0) continue;
      const hit = this.powerups.find((p) => Math.hypot(p.x - s.x, p.y - s.y) < POWER_RADIUS + this.radiusOf(s));
      if (!hit) continue;
      this.powerups = this.powerups.filter((p) => p !== hit);
      const ticks = POWER_SECONDS[hit.kind] * TICK_HZ;
      if (hit.kind === 'slow') {
        for (const o of this.snakes) if (o !== s && o.alive) o.fx.slow = ticks;
      } else {
        s.fx[hit.kind] = ticks;
      }
      ev.pickups.push({ idx: s.idx, kind: hit.kind });
    }
  }
}

export const POWERUP_RADIUS = POWER_RADIUS;
