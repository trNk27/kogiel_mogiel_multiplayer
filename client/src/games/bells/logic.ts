/**
 * Dzwonki (“little bells”): pure game logic. No DOM, no three.js. A Simon-says memory game.
 *
 * Four bells hang in a wooden highlander belfry. Each turn the belfry plays a tune, one bell at a
 * time; then everybody rings the whole tune back at once on their phone's four big keys. One wrong
 * bell, or running out of time, and you are out for the round. Everybody who gets it right goes on,
 * and the tune grows by one random note and plays a little faster. The last one standing wins the
 * round; if everybody left goes wrong on the same turn, they tie.
 *
 * Time is host clock milliseconds (`Date.now()` on the TV), passed in, so tests can drive it.
 */
import { mulberry32, type Rng } from '../rng';
import { eliminationPoints, eliminationWinners } from '../arena/elimination';

export { mulberry32 };
export type { Rng };

export const BELLS_ROUNDS = 2;
export const BELLS_ROUNDS_SHORT = 1;

/** The four bells, biggest (lowest) first: left to right on the TV, top-left to bottom-right on the phone. */
export const BELLS = [
  { name: 'Beetroot', color: '#ff3d6e', freq: 392.0, size: 1 },
  { name: 'Egg Yolk', color: '#ffd23f', freq: 523.25, size: 0.84 },
  { name: 'Dill', color: '#2fd6a8', freq: 659.25, size: 0.72 },
  { name: 'Blueberry', color: '#4f9dff', freq: 783.99, size: 0.62 },
] as const;
export const BELL_COUNT = BELLS.length;

/** The tune starts this long and grows by a note a turn, up to MAX_LEN (then the survivors share the win). */
export const START_LEN = 3;
export const MAX_LEN = 25;

// ---- timing (ms) ---------------------------------------------------------------------------------
/** A breath between the start of a turn and the first bell. */
export const LEAD_MS = 1000;
/** After the last bell of the tune, before the phones open up. */
export const TAIL_MS = 450;
/** How the turn went is shown this long before the next one. */
export const RESULT_MS = 1900;

/** Time from one bell of the tune to the next: a little quicker every turn. */
export const stepMs = (len: number) => Math.max(300, Math.round(640 * Math.pow(0.94, Math.max(0, len - START_LEN))));
/** How long a bell glows while the tune plays. */
export const litMs = (len: number) => Math.round(stepMs(len) * 0.72);
/** How long everybody has to ring a tune of `len` notes back. */
export const limitMs = (len: number) => 2500 + 800 * len;
/** How long the tune takes to play, from the start of the turn until the phones open up. */
export const listenMs = (len: number) => LEAD_MS + (len - 1) * stepMs(len) + litMs(len) + TAIL_MS;

/** Turn `turn` (1-based) plays a tune this long. */
export const lenAt = (turn: number) => Math.min(MAX_LEN, START_LEN + turn - 1);

/** A random bell; never the same bell three times running. */
export function nextNote(tune: readonly number[], rng: Rng): number {
  let b = Math.floor(rng() * BELL_COUNT) % BELL_COUNT;
  const n = tune.length;
  if (n >= 2 && tune[n - 1] === b && tune[n - 2] === b) b = (b + 1 + Math.floor(rng() * (BELL_COUNT - 1))) % BELL_COUNT;
  return b;
}

/** A fresh tune of `len` notes. */
export function makeTune(len: number, rng: Rng): number[] {
  const t: number[] = [];
  while (t.length < len) t.push(nextNote(t, rng));
  return t;
}

/** The tune one note longer (the old notes stay as they were). */
export function growTune(tune: readonly number[], rng: Rng): number[] {
  return [...tune, nextNote(tune, rng)];
}

export interface BellsPlayer {
  alive: boolean;
  gone: boolean;
  /** The turn this player went out on (null: still standing). */
  outAt: number | null;
  /** Why they went out. */
  why: 'wrong' | 'time' | null;
  /** Notes rung right so far this turn. */
  pos: number;
  /** Rang the whole tune this turn. */
  done: boolean;
  /** How long (ms) it took them to finish this turn. */
  doneIn: number;
  /** The longest tune rung back this round. */
  best: number;
}

export type BellsPhase = 'idle' | 'listen' | 'repeat' | 'result' | 'done';

export type BellsEvent =
  | { t: 'turn'; turn: number; len: number }
  | { t: 'note'; k: number; bell: number }
  | { t: 'repeat'; endsAt: number }
  | { t: 'out'; i: number; why: 'wrong' | 'time' }
  | { t: 'resolve'; turn: number; out: number[]; safe: number[] }
  | { t: 'over' };

export type TapResult = { i: number; bell: number; ok: true; pos: number; done: boolean } | { i: number; bell: number; ok: false; want: number };

export class BellsSim {
  readonly players: BellsPlayer[];
  phase: BellsPhase = 'idle';
  /** When the current phase started (host ms). */
  phaseAt = 0;
  turn = 0;
  tune: number[] = [];
  /** When the phones' time runs out (repeat phase). */
  endsAt = 0;
  over = false;
  readonly solo: boolean;
  /** Notes of the tune already played this turn. */
  played = 0;
  private fell: number[] = [];
  private overNext = false;

  constructor(
    count: number,
    private rng: Rng = Math.random,
    gone: boolean[] = [],
    /** Ask-view keys for this round start here (a round number × 1000, say), so every turn gets fresh ones. */
    readonly keyBase = 0,
  ) {
    this.players = Array.from({ length: count }, (_, i) => ({ alive: !gone[i], gone: !!gone[i], outAt: null, why: null, pos: 0, done: false, doneIn: 0, best: 0 }));
    this.solo = this.players.filter((p) => !p.gone).length <= 1;
  }

  get len() {
    return this.tune.length;
  }

  /** The key the phones' bell taps carry this turn (the same for listening and ringing back). */
  get key() {
    return this.keyBase + this.turn * 2;
  }

  /** The key for the screens after the turn (so they reset when the next one starts). */
  get afterKey() {
    return this.key + 1;
  }

  get aliveCount() {
    return this.players.filter((p) => p.alive && !p.gone).length;
  }

  begin(now: number) {
    if (this.phase !== 'idle') return [];
    const ev: BellsEvent[] = [];
    this.nextTurn(now, ev);
    return ev;
  }

  remove(i: number) {
    const p = this.players[i];
    if (!p) return;
    p.gone = true;
    p.alive = false;
  }

  /** The bell glowing right now while the tune plays (null between bells and in other phases). */
  lit(now: number): number | null {
    if (this.phase !== 'listen') return null;
    const t = now - this.phaseAt - LEAD_MS;
    if (t < 0) return null;
    const step = stepMs(this.len);
    const k = Math.floor(t / step);
    if (k >= this.len || t - k * step >= litMs(this.len)) return null;
    return this.tune[k];
  }

  /** Move the clock on to `now`. */
  step(now: number): BellsEvent[] {
    const ev: BellsEvent[] = [];
    const t = now - this.phaseAt;
    switch (this.phase) {
      case 'listen': {
        const step = stepMs(this.len);
        while (this.played < this.len && t >= LEAD_MS + this.played * step) {
          ev.push({ t: 'note', k: this.played, bell: this.tune[this.played] });
          this.played++;
        }
        if (t >= listenMs(this.len)) {
          this.phase = 'repeat';
          this.phaseAt = now;
          this.endsAt = now + limitMs(this.len);
          ev.push({ t: 'repeat', endsAt: this.endsAt });
        }
        break;
      }
      case 'repeat':
        if (now >= this.endsAt || this.everyoneDone()) this.resolve(now, ev);
        break;
      case 'result':
        if (t >= RESULT_MS) {
          if (this.overNext) {
            this.phase = 'done';
            this.over = true;
            ev.push({ t: 'over' });
          } else this.nextTurn(now, ev);
        }
        break;
    }
    return ev;
  }

  /**
   * Player `i` rang `bell` on a phone showing `key`. Ignored (null) unless it's the ringing-back part of
   * this turn and they are still ringing; a wrong bell puts them out.
   */
  tap(i: number, bell: number, key: number, now: number): TapResult | null {
    const p = this.players[i];
    if (!p || this.phase !== 'repeat' || key !== this.key || !p.alive || p.gone || p.done) return null;
    if (!Number.isInteger(bell) || bell < 0 || bell >= BELL_COUNT) return null;
    const want = this.tune[p.pos];
    if (bell !== want) {
      this.fall(i, 'wrong');
      return { i, bell, ok: false, want };
    }
    p.pos++;
    if (p.pos >= this.len) {
      p.done = true;
      p.doneIn = now - this.phaseAt;
      p.best = Math.max(p.best, this.len);
    }
    return { i, bell, ok: true, pos: p.pos, done: p.done };
  }

  private everyoneDone() {
    return this.players.every((p) => p.gone || !p.alive || p.done);
  }

  private nextTurn(now: number, ev: BellsEvent[]) {
    this.turn++;
    this.tune = this.turn === 1 ? makeTune(START_LEN, this.rng) : growTune(this.tune, this.rng);
    this.played = 0;
    this.fell = [];
    for (const p of this.players) {
      p.pos = 0;
      p.done = false;
      p.doneIn = 0;
    }
    this.phase = 'listen';
    this.phaseAt = now;
    ev.push({ t: 'turn', turn: this.turn, len: this.len });
  }

  private fall(i: number, why: 'wrong' | 'time') {
    const p = this.players[i];
    p.alive = false;
    p.outAt = this.turn;
    p.why = why;
    this.fell.push(i);
  }

  private resolve(now: number, ev: BellsEvent[]) {
    // Who was already out (a wrong bell) is told as it happens; the slow ones go now.
    const safe: number[] = [];
    this.players.forEach((p, i) => {
      if (p.gone || !p.alive) return;
      if (p.done) safe.push(i);
      else {
        this.fall(i, 'time');
        ev.push({ t: 'out', i, why: 'time' });
      }
    });
    ev.push({ t: 'resolve', turn: this.turn, out: [...this.fell], safe });
    this.phase = 'result';
    this.phaseAt = now;
    const alive = this.aliveCount;
    this.overNext = (this.solo ? alive === 0 : alive <= 1) || this.len >= MAX_LEN;
  }

  /** Round points: last one standing in a group (see `eliminationPoints`), the longest tune on your own. */
  results() {
    const outAt = this.players.map((p) => p.outAt);
    const gone = this.players.map((p) => p.gone);
    return {
      points: this.solo ? this.players.map((p) => (p.gone ? 0 : p.best)) : eliminationPoints(outAt, gone, false, 0),
      winners: eliminationWinners(outAt, gone, this.solo),
      best: Math.max(0, ...this.players.map((p) => p.best)),
    };
  }
}

export function howTo(short: boolean): string[] {
  return ['Listen to the bells, then ring the tune back', 'One wrong bell or too slow: you’re out!', short ? 'One round · a note longer every turn' : 'Two rounds · a note longer every turn'];
}
