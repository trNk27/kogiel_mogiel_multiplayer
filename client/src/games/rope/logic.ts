/**
 * Skakanka: pure simulation. No DOM, no three.js. Our take on Mario Party’s Hot Rope Jump.
 *
 * Two babcias turn a long rope of kiełbasa over a line of pierogi. Every time it sweeps along the
 * ground, everybody still in the game has to be in the air; whoever isn’t trips and is out. The rope
 * turns faster and faster, with the odd lull or sudden burst to catch you out.
 *
 * World units are metres, y is up. The rope turns about the x axis at height ROPE_H; the pierogi stand
 * in a row along x at z = 0, the camera looks from +z.
 */
import { mulberry32, type Rng } from '../rng';
import { eliminationPoints, eliminationWinners } from '../arena/elimination';

export { mulberry32 };
export type { Rng };

export const DT = 1 / 60;

/** Full game / tournament version. */
export const ROPE_ROUNDS = 3;
export const ROPE_ROUNDS_SHORT = 1;

// ---- jumping -------------------------------------------------------------------------------------
export const JUMP_V = 5.4;
export const GRAVITY = 23;
/** Feet must be at least this high when the rope sweeps underneath. */
export const CLEAR = 0.32;
/** A press this long before landing still jumps, as soon as you touch down. */
export const JUMP_BUFFER = 0.1;
/** How long a jump lasts, and how long you are high enough to clear the rope. */
export const AIR_TIME = (2 * JUMP_V) / GRAVITY;
export const clearWindow = () => {
  const d = Math.sqrt(JUMP_V * JUMP_V - 2 * GRAVITY * CLEAR);
  return { from: (JUMP_V - d) / GRAVITY, to: (JUMP_V + d) / GRAVITY };
};

// ---- the rope -------------------------------------------------------------------------------------
/** Height of the rope's axis (the babcias' hands) and how far the middle of the rope swings out. */
export const ROPE_H = 1.35;
export const ROPE_R = 1.3;
/** Nothing happens for this long after GO; then the rope starts at the top. */
export const WAIT_TIME = 0.8;
/** The first turn is slow, so everybody finds the beat. */
export const FIRST_PERIOD = 1.9;
/** Then each turn is a little quicker than the last, down to MIN_PERIOD. */
export const START_PERIOD = 1.55;
export const PERIOD_DECAY = 0.955;
export const MIN_PERIOD = 0.66;
/** A surprise turn is never quicker than this. */
export const FASTEST = 0.56;
/** Surprises start after this many jumps. */
export const SURPRISE_FROM = 8;
export const SURPRISE_CHANCE = 0.22;
/** The round ends after this many jumps, whoever is still standing (they share the win). */
export const MAX_JUMPS = 45;

export type TurnKind = 'normal' | 'slow' | 'fast';

/** How long turn `n` (1-based) takes, without surprises. */
export function basePeriod(n: number) {
  if (n <= 1) return FIRST_PERIOD;
  return Math.max(MIN_PERIOD, START_PERIOD * Math.pow(PERIOD_DECAY, n - 2));
}

/** Turn `n`: how long it takes and whether it is a surprise. */
export function turnFor(n: number, rng: Rng): { period: number; kind: TurnKind } {
  const base = basePeriod(n);
  if (n >= SURPRISE_FROM && rng() < SURPRISE_CHANCE) {
    if (rng() < 0.5) return { period: base * 1.45, kind: 'slow' };
    return { period: Math.max(FASTEST, base * 0.8), kind: 'fast' };
  }
  return { period: base, kind: 'normal' };
}

/** Where the middle of the rope is at `phase` (0 = top, 0.25 = in front, 0.5 = on the ground). */
export function ropeAt(phase: number) {
  const a = phase * Math.PI * 2;
  return { y: ROPE_H + ROPE_R * Math.cos(a), z: ROPE_R * Math.sin(a) };
}

// ---- players ----------------------------------------------------------------------------------------
/** Gap between pierogi in the row. */
export const SPACING = 1.9;

/** Where player `i` of `n` stands. */
export const spotX = (i: number, n: number) => (i - (n - 1) / 2) * SPACING;

export interface RopePlayer {
  x: number;
  y: number;
  vy: number;
  alive: boolean;
  gone: boolean;
  /** The jump this player tripped on. */
  outAt: number | null;
  /** Sim time of the last press that hasn’t become a jump yet (-1: none). */
  buffered: number;
  jumps: number;
}

export type RopePhase = 'idle' | 'wait' | 'turn' | 'done';

export type RopeEvent =
  | { t: 'turn'; n: number; period: number; kind: TurnKind }
  | { t: 'jump'; i: number }
  | { t: 'land'; i: number }
  | { t: 'pass'; n: number; tripped: number[]; cleared: number[] }
  | { t: 'over' };

export class RopeSim {
  readonly players: RopePlayer[];
  phase: RopePhase = 'idle';
  phaseT = 0;
  time = 0;
  /** The rope: 0..1 per turn, 0 = at the top. */
  rope = 0;
  /** The turn the rope is on (1-based); its sweep along the ground is jump `n`. */
  n = 0;
  period = FIRST_PERIOD;
  kind: TurnKind = 'normal';
  /** Jumps the rope has made (sweeps along the ground). */
  passes = 0;
  over = false;
  readonly solo: boolean;
  /** Rope speed while winding down after the round (turns per second). */
  private spin = 0;

  constructor(
    count: number,
    private rng: Rng = Math.random,
    gone: boolean[] = [],
  ) {
    this.players = Array.from({ length: count }, (_, i) => ({
      x: spotX(i, count),
      y: 0,
      vy: 0,
      alive: !gone[i],
      gone: !!gone[i],
      outAt: null,
      buffered: -1,
      jumps: 0,
    }));
    this.solo = this.players.filter((p) => !p.gone).length <= 1;
  }

  begin() {
    if (this.phase !== 'idle') return;
    this.phase = 'wait';
    this.phaseT = 0;
  }

  get aliveCount() {
    return this.players.filter((p) => p.alive && !p.gone).length;
  }

  remove(i: number) {
    const p = this.players[i];
    if (!p) return;
    p.gone = true;
    p.alive = false;
  }

  /** `presses[i]`: jump presses from player i since the last step. */
  step(presses: readonly number[]): RopeEvent[] {
    const ev: RopeEvent[] = [];
    this.time += DT;
    this.phaseT += DT;
    this.movePlayers(presses, ev);
    switch (this.phase) {
      case 'wait':
        if (this.phaseT >= WAIT_TIME) {
          this.phase = 'turn';
          this.phaseT = 0;
          this.nextTurn(ev);
        }
        break;
      case 'turn': {
        const before = this.rope;
        this.rope += DT / this.period;
        if (before < 0.5 && this.rope >= 0.5) this.pass(ev);
        if (this.rope >= 1) {
          this.rope -= 1;
          if (this.over) {
            this.phase = 'done';
            this.spin = 1 / this.period;
          } else this.nextTurn(ev);
        }
        break;
      }
      case 'done':
        // Wind down to a stop.
        this.spin *= Math.exp(-1.6 * DT);
        this.rope = (this.rope + this.spin * DT) % 1;
        break;
    }
    if (!this.over && this.phase !== 'idle' && this.checkOver()) {
      this.over = true;
      ev.push({ t: 'over' });
    }
    return ev;
  }

  private checkOver() {
    const alive = this.aliveCount;
    return this.solo ? alive === 0 : alive <= 1;
  }

  private nextTurn(ev: RopeEvent[]) {
    this.n++;
    const t = turnFor(this.n, this.rng);
    this.period = t.period;
    this.kind = t.kind;
    ev.push({ t: 'turn', n: this.n, period: t.period, kind: t.kind });
  }

  private pass(ev: RopeEvent[]) {
    if (this.over) return;
    this.passes = this.n;
    const tripped: number[] = [];
    const cleared: number[] = [];
    this.players.forEach((p, i) => {
      if (!p.alive || p.gone) return;
      if (p.y >= CLEAR) {
        p.jumps++;
        cleared.push(i);
      } else {
        p.alive = false;
        p.outAt = this.n;
        tripped.push(i);
      }
    });
    ev.push({ t: 'pass', n: this.n, tripped, cleared });
    if (this.n >= MAX_JUMPS) {
      this.over = true;
      ev.push({ t: 'over' });
    }
  }

  private movePlayers(presses: readonly number[], ev: RopeEvent[]) {
    const canJump = this.phase === 'wait' || this.phase === 'turn';
    this.players.forEach((p, i) => {
      if (p.gone) return;
      if (p.alive && canJump && (presses[i] ?? 0) > 0) p.buffered = this.time;
      if (p.y > 0 || p.vy > 0) {
        p.vy -= GRAVITY * DT;
        p.y += p.vy * DT;
        if (p.y <= 0) {
          p.y = 0;
          p.vy = 0;
          ev.push({ t: 'land', i });
        }
      }
      const grounded = p.y <= 0 && p.vy <= 0;
      if (grounded && p.alive && p.buffered >= 0) {
        if (this.time - p.buffered <= JUMP_BUFFER + 1e-9) {
          p.vy = JUMP_V;
          p.y = p.vy * DT;
          ev.push({ t: 'jump', i });
        }
        p.buffered = -1;
      }
    });
  }

  results() {
    const outAt = this.players.map((p) => p.outAt);
    const gone = this.players.map((p) => p.gone);
    return {
      points: eliminationPoints(outAt, gone, this.solo, this.passes),
      winners: eliminationWinners(outAt, gone, this.solo),
      jumps: this.passes,
    };
  }
}

export function howTo(short: boolean): string[] {
  return ['Tap JUMP as the rope sweeps the ground', 'It gets faster – and sometimes sneaky', short ? 'One round · last one jumping wins' : 'Three rounds · last one jumping wins'];
}
