/**
 * Babcia Mówi (“Babcia says”): pure game logic. No DOM, no three.js. Our take on Mario Party’s
 * Shy Guy Says, with Poland’s white and red flags.
 *
 * Babcia stands on a stool and calls a flag: “RED up!”, “WHITE up!”, later “DON’T raise red!” (so
 * raise the white one) and “BOTH up!”. Everybody raises what she says on their phone before time
 * runs out. Raise the wrong flag, or too late, and the plank under you tips you into the pond. Her
 * own flags sometimes lie: only her words count. The calls come faster and faster; the last pierogi
 * on the jetty wins.
 */
import { mulberry32, type Rng } from '../rng';
import { eliminationPoints, eliminationWinners } from '../arena/elimination';

export { mulberry32 };
export type { Rng };

export const DT = 1 / 60;

export const FLAGS_ROUNDS = 2;
export const FLAGS_ROUNDS_SHORT = 1;

/** Flags as bits: white is button 0 (left), red is button 1 (right). */
export const WHITE = 1;
export const RED = 2;
export const BOTH = WHITE | RED;

export type CallKind = 'white' | 'red' | 'notWhite' | 'notRed' | 'both';

/** What a call asks you to raise. */
export function wanted(kind: CallKind): number {
  switch (kind) {
    case 'white':
    case 'notRed':
      return WHITE;
    case 'red':
    case 'notWhite':
      return RED;
    case 'both':
      return BOTH;
  }
}

/** How a call reads on the TV: the big English line and Babcia’s Polish. */
export function callWords(kind: CallKind): { en: string; pl: string } {
  switch (kind) {
    case 'white':
      return { en: 'WHITE up!', pl: 'Biała w górę!' };
    case 'red':
      return { en: 'RED up!', pl: 'Czerwona w górę!' };
    case 'notWhite':
      return { en: 'DON’T raise WHITE!', pl: 'Nie podnoś białej!' };
    case 'notRed':
      return { en: 'DON’T raise RED!', pl: 'Nie podnoś czerwonej!' };
    case 'both':
      return { en: 'BOTH up!', pl: 'Obie w górę!' };
  }
}

// ---- timing (seconds) --------------------------------------------------------------------------
/** A breather after GO before the first call. */
export const WAIT_TIME = 1.2;
/** Time to answer call 1; each call after is a little quicker, down to MIN_LIMIT. */
export const START_LIMIT = 2.3;
export const LIMIT_DECAY = 0.94;
export const MIN_LIMIT = 0.9;
/** BOTH gives you a moment longer (two buttons). */
export const BOTH_EXTRA = 0.35;
/** The pause between one call and the next (flags down, splashes). */
export const GAP_TIME = 1.1;
/** Babcia says “Don’t…” from this call on, BOTH from this one, and her flags start lying from this one. */
export const NOT_FROM = 4;
export const BOTH_FROM = 9;
export const TRICK_FROM = 6;
/** The round ends after this many calls, whoever is still dry (they share the win). */
export const MAX_CALLS = 35;

export const timeLimit = (n: number, kind: CallKind) => Math.max(MIN_LIMIT, START_LIMIT * Math.pow(LIMIT_DECAY, n - 1)) + (kind === 'both' ? BOTH_EXTRA : 0);

export interface Call {
  n: number;
  kind: CallKind;
  /** The flags Babcia herself raises (bits); on a trick call they aren’t what she says. */
  shown: number;
  limit: number;
}

/** Make call `n`. `prev` (the last call’s kind) is avoided three times running so it doesn’t get stale. */
export function makeCall(n: number, rng: Rng, prev: CallKind[] = []): Call {
  const kinds: CallKind[] = ['white', 'red'];
  if (n >= NOT_FROM) kinds.push('notWhite', 'notRed');
  if (n >= BOTH_FROM) kinds.push('both');
  let kind: CallKind = kinds[Math.floor(rng() * kinds.length)];
  // BOTH is rarer than the rest.
  if (kind === 'both' && rng() < 0.5) kind = rng() < 0.5 ? 'white' : 'red';
  // Not the same call three times in a row.
  if (prev.length >= 2 && prev[prev.length - 1] === kind && prev[prev.length - 2] === kind) kind = kinds[(kinds.indexOf(kind) + 1) % kinds.length];
  const want = wanted(kind);
  let shown = want;
  if (kind === 'notWhite') shown = WHITE;
  else if (kind === 'notRed') shown = RED;
  else if (n >= TRICK_FROM && kind !== 'both' && rng() < 0.3) shown = want === WHITE ? RED : WHITE;
  return { n, kind, shown, limit: timeLimit(n, kind) };
}

export interface FlagsPlayer {
  alive: boolean;
  gone: boolean;
  /** The call this player fell in on. */
  outAt: number | null;
  /** Flags raised for the current call (bits). */
  raised: number;
  /** Got the current call right. */
  locked: boolean;
  /** Seconds it took to get the current call right. */
  time: number;
  /** Calls answered right this round. */
  right: number;
}

export type FlagsPhase = 'idle' | 'wait' | 'call' | 'gap' | 'done';

export type FlagsEvent =
  | { t: 'call'; call: Call }
  | { t: 'raise'; i: number; flag: number }
  | { t: 'lock'; i: number }
  /** Raised the wrong flag (`wrong`) or ran out of time. */
  | { t: 'out'; i: number; wrong: boolean }
  | { t: 'resolve'; n: number; out: number[]; safe: number[] }
  | { t: 'over' };

export class FlagsSim {
  readonly players: FlagsPlayer[];
  phase: FlagsPhase = 'idle';
  phaseT = 0;
  call: Call | null = null;
  /** Calls made so far. */
  calls = 0;
  over = false;
  readonly solo: boolean;
  private history: CallKind[] = [];
  /** Who fell in on the current call. */
  private fell: number[] = [];

  constructor(
    count: number,
    private rng: Rng = Math.random,
    gone: boolean[] = [],
  ) {
    this.players = Array.from({ length: count }, (_, i) => ({ alive: !gone[i], gone: !!gone[i], outAt: null, raised: 0, locked: false, time: 0, right: 0 }));
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

  /** `presses[i]`: [white presses, red presses] from player i since the last step. */
  step(presses: readonly (readonly number[])[]): FlagsEvent[] {
    const ev: FlagsEvent[] = [];
    this.phaseT += DT;
    switch (this.phase) {
      case 'wait':
        if (this.phaseT >= WAIT_TIME) this.nextCall(ev);
        break;
      case 'call':
        this.answer(presses, ev);
        if (this.phaseT >= (this.call?.limit ?? 0) || this.everyoneDone()) this.resolve(ev);
        break;
      case 'gap':
        if (this.phaseT >= GAP_TIME) {
          if (this.over) this.phase = 'done';
          else this.nextCall(ev);
        }
        break;
    }
    if (!this.over && this.phase !== 'idle' && this.phase !== 'call' && this.checkOver()) {
      this.over = true;
      ev.push({ t: 'over' });
    }
    return ev;
  }

  private checkOver() {
    const alive = this.aliveCount;
    return this.solo ? alive === 0 : alive <= 1;
  }

  private everyoneDone() {
    return this.players.every((p) => p.gone || !p.alive || p.locked);
  }

  private nextCall(ev: FlagsEvent[]) {
    this.calls++;
    this.call = makeCall(this.calls, this.rng, this.history);
    this.history.push(this.call.kind);
    this.fell = [];
    for (const p of this.players) {
      p.raised = 0;
      p.locked = false;
      p.time = 0;
    }
    this.phase = 'call';
    this.phaseT = 0;
    ev.push({ t: 'call', call: this.call });
  }

  private answer(presses: readonly (readonly number[])[], ev: FlagsEvent[]) {
    const call = this.call;
    if (!call) return;
    const want = wanted(call.kind);
    this.players.forEach((p, i) => {
      if (!p.alive || p.gone || p.locked) return;
      const pr = presses[i] ?? [];
      for (const [b, flag] of [
        [0, WHITE],
        [1, RED],
      ] as const) {
        if (!((pr[b] ?? 0) > 0) || !p.alive || p.locked) continue;
        p.raised |= flag;
        ev.push({ t: 'raise', i, flag });
        if (!(want & flag)) {
          this.fall(i, true, ev);
        } else if ((p.raised & want) === want) {
          p.locked = true;
          p.time = this.phaseT;
          p.right++;
          ev.push({ t: 'lock', i });
        }
      }
    });
  }

  private fall(i: number, wrong: boolean, ev: FlagsEvent[]) {
    const p = this.players[i];
    p.alive = false;
    p.outAt = this.calls;
    this.fell.push(i);
    ev.push({ t: 'out', i, wrong });
  }

  private resolve(ev: FlagsEvent[]) {
    const safe: number[] = [];
    this.players.forEach((p, i) => {
      if (p.gone || !p.alive) return;
      if (p.locked) safe.push(i);
      else this.fall(i, false, ev);
    });
    ev.push({ t: 'resolve', n: this.calls, out: [...this.fell], safe });
    this.phase = 'gap';
    this.phaseT = 0;
    if (!this.over && (this.checkOver() || this.calls >= MAX_CALLS)) {
      this.over = true;
      ev.push({ t: 'over' });
    }
  }

  results() {
    const outAt = this.players.map((p) => p.outAt);
    const gone = this.players.map((p) => p.gone);
    return {
      points: eliminationPoints(outAt, gone, this.solo, this.calls),
      winners: eliminationWinners(outAt, gone, this.solo),
      calls: this.calls,
    };
  }
}

export function howTo(short: boolean): string[] {
  return ['Raise the flag Babcia SAYS – left white, right red', 'Wrong flag or too slow: into the pond!', short ? 'One round · watch out for “DON’T…”' : 'Two rounds · watch out for “DON’T…”'];
}
