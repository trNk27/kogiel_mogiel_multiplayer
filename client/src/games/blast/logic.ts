/**
 * Petarda: pure game logic. No DOM, no three.js. Our take on Mario Party’s Bowser’s Big Blast.
 *
 * It is New Year’s Eve. A row of detonator plungers is wired to one giant firecracker, but only one of
 * them is live. Players take turns: pick a plunger and push it. A dud fizzles out; the live one sets
 * off the firecracker and blasts whoever pushed it out of the round. Then the plungers are set up
 * again, one for each player still in, and it goes on until one pierogi is left.
 *
 * Every set has exactly as many plungers as players left and everybody pushes once, so each player
 * has the same chance of finding the big one.
 */
import { mulberry32, type Rng } from '../rng';
import { eliminationPoints, eliminationWinners } from '../arena/elimination';

export { mulberry32 };
export type { Rng };

export const DT = 1 / 60;

export const BLAST_ROUNDS = 2;
export const BLAST_ROUNDS_SHORT = 1;

// ---- timing (seconds) --------------------------------------------------------------------------
/** The plungers pop up for a new set. */
export const SETUP_TIME = 1.3;
/** How long you have to pick a plunger before one is pushed for you. */
export const TURN_TIME = 6;
/** A player who isn’t connected gets this long instead. */
export const ABSENT_TURN_TIME = 1.2;
/** The spark runs along the wire for this long before you know. */
export const FUSE_TIME = 1.4;
/** A pause after a dud before the next turn. */
export const SAFE_TIME = 0.7;
/** The blast, the flight and the landing. */
export const BOOM_TIME = 3.2;
/** Holding the stick to one side moves the selection again after this long. */
export const STICK_REPEAT = 0.32;
/** How far the stick has to lean to move the selection. */
export const STICK_DEAD = 0.45;

export interface BlastPlayer {
  alive: boolean;
  gone: boolean;
  /** The set this player was blasted in. */
  outAt: number | null;
}

export interface Plunger {
  /** Pushed already (or taken away because somebody left). */
  used: boolean;
  /** Who pushed it, or -1. */
  by: number;
  /** Taken away because a player left mid-set. */
  dud?: boolean;
}

export interface BlastInput {
  /** Stick, -1..1 (only the current player’s counts). */
  x: number;
  /** Push presses since the last step. */
  push: number;
  /** Connected and still in the room. */
  live: boolean;
}

export type BlastPhase = 'idle' | 'setup' | 'choose' | 'fuse' | 'safe' | 'boom' | 'done';

export type BlastEvent =
  | { t: 'set'; n: number; plungers: number }
  | { t: 'turn'; i: number }
  | { t: 'move'; i: number; to: number }
  | { t: 'push'; i: number; plunger: number; auto: boolean }
  | { t: 'safe'; i: number; plunger: number }
  | { t: 'boom'; i: number; plunger: number }
  | { t: 'over' };

export class BlastSim {
  readonly players: BlastPlayer[];
  phase: BlastPhase = 'idle';
  phaseT = 0;
  /** Sets played so far (1 for the first). */
  set = 0;
  plungers: Plunger[] = [];
  /** The live plunger of this set. */
  bomb = 0;
  /** Who pushes this set, in order. */
  order: number[] = [];
  /** Index into `order` of the player whose turn it is. */
  turn = 0;
  /** The plunger the current player has picked. */
  cursor = 0;
  /** The plunger that was pushed last. */
  pushed = -1;
  /** Who was blasted last (the next set starts with the player after them). */
  lastOut = -1;
  over = false;
  /** Seconds the current turn lasts (shorter for an absent player). */
  turnTime = TURN_TIME;
  private lean = 0;
  private leanT = 0;
  /** Events from outside a step (the first set, someone leaving), handed out by the next step. */
  private pending: BlastEvent[] = [];

  constructor(
    count: number,
    private rng: Rng = Math.random,
    gone: boolean[] = [],
  ) {
    this.players = Array.from({ length: count }, (_, i) => ({ alive: !gone[i], gone: !!gone[i], outAt: null }));
  }

  get aliveCount() {
    return this.players.filter((p) => p.alive && !p.gone).length;
  }

  /** Whose turn it is, or -1. */
  get current() {
    return this.phase === 'choose' || this.phase === 'fuse' || this.phase === 'safe' || this.phase === 'boom' ? (this.order[this.turn] ?? -1) : -1;
  }

  /** Plungers not pushed yet. */
  get left() {
    return this.plungers.filter((p) => !p.used).length;
  }

  begin() {
    if (this.phase !== 'idle') return;
    this.newSet(this.pending);
  }

  remove(i: number) {
    const p = this.players[i];
    if (!p || p.gone) return;
    const wasAlive = p.alive;
    p.gone = true;
    p.alive = false;
    if (!wasAlive || this.phase === 'idle' || this.phase === 'done' || this.over) return;
    const k = this.order.indexOf(i);
    if (k < 0) return;
    const pushedAlready = k < this.turn || (k === this.turn && this.phase !== 'choose');
    if (pushedAlready) return;
    // They won't push this set: take away one dud so there are as many plungers as pushers again.
    const duds = this.plungers.map((pl, j) => (!pl.used && j !== this.bomb ? j : -1)).filter((j) => j >= 0);
    if (duds.length) {
      const j = duds[Math.floor(this.rng() * duds.length)];
      this.plungers[j].used = true;
      this.plungers[j].dud = true;
    }
    this.order.splice(k, 1);
    if (k === this.turn && this.phase === 'choose') {
      // It was their turn: whoever is next goes now (or, if they were the last, the set starts again).
      if (this.turn >= this.order.length) this.newSet(this.pending);
      else this.startTurn(this.pending);
    } else if (k < this.turn) this.turn--;
  }

  step(inputs: readonly BlastInput[]): BlastEvent[] {
    const ev: BlastEvent[] = this.pending.splice(0);
    this.phaseT += DT;
    switch (this.phase) {
      case 'setup':
        if (this.phaseT >= SETUP_TIME) this.startTurn(ev);
        break;
      case 'choose':
        this.choose(inputs, ev);
        break;
      case 'fuse':
        if (this.phaseT >= FUSE_TIME) {
          const i = this.current;
          if (this.pushed === this.bomb) {
            this.phase = 'boom';
            this.phaseT = 0;
            const p = this.players[i];
            if (p && !p.gone) {
              p.alive = false;
              p.outAt = this.set;
            }
            this.lastOut = i;
            ev.push({ t: 'boom', i, plunger: this.pushed });
          } else {
            this.phase = 'safe';
            this.phaseT = 0;
            ev.push({ t: 'safe', i, plunger: this.pushed });
          }
        }
        break;
      case 'safe':
        if (this.phaseT >= SAFE_TIME) {
          this.turn++;
          if (this.turn >= this.order.length) this.newSet(ev);
          else this.startTurn(ev);
        }
        break;
      case 'boom':
        if (this.phaseT >= BOOM_TIME) this.newSet(ev);
        break;
    }
    if (!this.over && this.phase !== 'idle' && this.aliveCount <= 1) {
      this.over = true;
      if (this.phase !== 'boom') this.phase = 'done';
      ev.push({ t: 'over' });
    }
    if (this.over && this.phase === 'boom' && this.phaseT >= BOOM_TIME) this.phase = 'done';
    return ev;
  }

  private newSet(ev: BlastEvent[]) {
    if (this.over) {
      this.phase = 'done';
      return;
    }
    const alive = this.players.map((_, i) => i).filter((i) => this.players[i].alive && !this.players[i].gone);
    if (alive.length <= 1) {
      this.phase = 'done';
      return;
    }
    this.set++;
    this.plungers = alive.map(() => ({ used: false, by: -1 }));
    this.bomb = Math.floor(this.rng() * alive.length);
    // Start with the player after the last one blasted (or anyone, the first time).
    let start: number;
    if (this.lastOut < 0) start = Math.floor(this.rng() * alive.length);
    else {
      start = alive.findIndex((i) => i > this.lastOut);
      if (start < 0) start = 0;
    }
    this.order = [...alive.slice(start), ...alive.slice(0, start)];
    this.turn = 0;
    this.pushed = -1;
    this.phase = 'setup';
    this.phaseT = 0;
    ev.push({ t: 'set', n: this.set, plungers: this.plungers.length });
  }

  private startTurn(ev: BlastEvent[]) {
    if (!this.order.length) {
      this.newSet(ev);
      return;
    }
    this.phase = 'choose';
    this.phaseT = 0;
    this.turnTime = TURN_TIME;
    this.lean = 0;
    this.leanT = 0;
    // Start on the free plunger nearest the middle.
    const free = this.freePlungers();
    const mid = (this.plungers.length - 1) / 2;
    this.cursor = free.reduce((b, j) => (Math.abs(j - mid) < Math.abs(b - mid) ? j : b), free[0] ?? 0);
    ev.push({ t: 'turn', i: this.current });
  }

  private freePlungers() {
    return this.plungers.map((p, j) => (p.used ? -1 : j)).filter((j) => j >= 0);
  }

  /** Move the selection one free plunger left (-1) or right (+1); it stops at the ends. */
  moveCursor(dir: number) {
    const free = this.freePlungers();
    const next = dir > 0 ? free.find((j) => j > this.cursor) : [...free].reverse().find((j) => j < this.cursor);
    if (next === undefined) return false;
    this.cursor = next;
    return true;
  }

  private choose(inputs: readonly BlastInput[], ev: BlastEvent[]) {
    const i = this.current;
    const inp = inputs[i] ?? { x: 0, push: 0, live: false };
    if (!inp.live) this.turnTime = Math.min(this.turnTime, Math.max(this.phaseT, ABSENT_TURN_TIME));
    const x = Number.isFinite(inp.x) ? inp.x : 0;
    const dir = x > STICK_DEAD ? 1 : x < -STICK_DEAD ? -1 : 0;
    if (dir !== this.lean) {
      this.lean = dir;
      this.leanT = 0;
      if (dir && this.moveCursor(dir)) ev.push({ t: 'move', i, to: this.cursor });
    } else if (dir) {
      this.leanT += DT;
      if (this.leanT >= STICK_REPEAT) {
        this.leanT = 0;
        if (this.moveCursor(dir)) ev.push({ t: 'move', i, to: this.cursor });
      }
    }
    if (inp.push > 0 && inp.live) this.push(this.cursor, false, ev);
    else if (this.phaseT >= this.turnTime) {
      const free = this.freePlungers();
      this.push(free[Math.floor(this.rng() * free.length)] ?? this.cursor, true, ev);
    }
  }

  private push(j: number, auto: boolean, ev: BlastEvent[]) {
    const pl = this.plungers[j];
    if (!pl || pl.used) return;
    const i = this.current;
    pl.used = true;
    pl.by = i;
    this.cursor = j;
    this.pushed = j;
    this.phase = 'fuse';
    this.phaseT = 0;
    ev.push({ t: 'push', i, plunger: j, auto });
  }

  results() {
    const outAt = this.players.map((p) => p.outAt);
    const gone = this.players.map((p) => p.gone);
    return {
      points: eliminationPoints(outAt, gone, false, this.set),
      winners: eliminationWinners(outAt, gone, false),
    };
  }
}

export function howTo(short: boolean): string[] {
  return ['On your turn, pick a plunger (◀ ▶) and Push', 'One of them sets off the big firecracker', short ? 'One round · last pierogi standing wins' : 'Two rounds · last pierogi standing wins'];
}
