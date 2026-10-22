/**
 * Głuchy Telefon – the pure rules: who works on which chain at every step, what they are handed,
 * timeouts and placeholders, and the favourite-entry votes. No DOM; driven by TelephoneGame.
 */
import { DOODLE_COLORS, DOODLE_SPACE, DOODLE_WIDTHS, MAX_DOODLE_POINTS, type Stroke } from '../../../../shared/protocol';
import type { Rng } from '../rng';
import { pickQuestions, shuffle } from '../quiz/logic';

export interface TelSentence {
  id: string;
  text: string;
}

export const TEL_WRITE_MS = 40_000;
export const TEL_DRAW_MS = 75_000;
export const TEL_DESCRIBE_MS = 35_000;
export const TEL_VOTE_MS = 15_000;
/** Longest sentence or guess. */
export const TEL_MAX_TEXT = 60;
/** Points per vote for your entry. */
export const TEL_VOTE_POINTS = 100;
/** At most this many steps per chain (the first sentence included). */
export const TEL_FULL_STEPS = 6;
export const TEL_SHORT_STEPS = 4;
/** Most points kept from one drawing (the phone's pad stops there too), so a `pic` view stays small. */
export const TEL_MAX_POINTS = MAX_DOODLE_POINTS;
export const TEL_MAX_STROKES = 600;

/** What a timed-out guess and a removed player's entries say. */
export const NO_IDEA = '(no idea)';
export const LEFT_GAME = '(left the game)';
/** What you draw when the sentence you were handed is empty. */
export const DRAW_ANYTHING = 'Draw anything!';

export type StepKind = 'write' | 'draw' | 'describe';

export function howTo(short: boolean): string[] {
  return [
    'Write a silly sentence – pass it on',
    'Draw what you get, describe what you see',
    short ? 'Up to 4 steps · vote for the best' : 'Watch it go wrong · vote for the best',
  ];
}

/** Steps per chain: everyone touches every chain once, capped so the game stays short. */
export function stepCount(players: number, short = false): number {
  return Math.max(0, Math.min(players, short ? TEL_SHORT_STEPS : TEL_FULL_STEPS));
}

/** Step 0 is the sentence, then drawing and describing take turns. */
export function stepKind(step: number): StepKind {
  return step === 0 ? 'write' : step % 2 === 1 ? 'draw' : 'describe';
}

export function stepMs(step: number): number {
  const k = stepKind(step);
  return k === 'write' ? TEL_WRITE_MS : k === 'draw' ? TEL_DRAW_MS : TEL_DESCRIBE_MS;
}

/** The seat that works on chain `chain` at step `step` (chain c starts with seat c and moves one seat on per step). */
export function seatFor(chain: number, step: number, seats: number): number {
  return (chain + step) % seats;
}

/** The chain seat `seat` works on at step `step`. */
export function chainFor(seat: number, step: number, seats: number): number {
  return (((seat - step) % seats) + seats) % seats;
}

/** Clean up a typed sentence or guess. Returns '' if nothing usable is left. */
export function sanitizeText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, TEL_MAX_TEXT)
    .trim();
}

/**
 * Check a drawing from a phone and normalise it: coordinates rounded into the canvas, and anything
 * past TEL_MAX_POINTS / TEL_MAX_STROKES cut off (so a `pic` view stays well under the relay limit).
 * Returns null if it is malformed. An empty drawing is fine.
 */
export function cleanStrokes(raw: unknown): Stroke[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Stroke[] = [];
  let points = 0;
  for (const s of raw) {
    if (!Array.isArray(s) || s.length < 4 || s.length % 2 !== 0) return null;
    const [c, w] = s;
    if (!Number.isInteger(c) || c < 0 || c >= DOODLE_COLORS.length) return null;
    if (!Number.isInteger(w) || w < 0 || w >= DOODLE_WIDTHS.length) return null;
    for (let i = 2; i < s.length; i++) if (typeof s[i] !== 'number' || !Number.isFinite(s[i])) return null;
    if (out.length >= TEL_MAX_STROKES || points >= TEL_MAX_POINTS) continue;
    const room = TEL_MAX_POINTS - points;
    const n = Math.min((s.length - 2) / 2, room);
    const stroke: Stroke = [c, w];
    for (let i = 2; i < 2 + n * 2; i++) stroke.push(Math.max(0, Math.min(DOODLE_SPACE, Math.round(s[i]))));
    points += n;
    out.push(stroke);
  }
  return out;
}

export interface Entry {
  /** Who made it (a player id). */
  by: string;
  kind: StepKind;
  /** The sentence or guess (write / describe). */
  text?: string;
  /** The drawing (draw). */
  strokes?: Stroke[];
  /** Picked by "🎲 Pick for me" (or for you, when time ran out on the first step). */
  auto?: boolean;
  /** A placeholder: time ran out, or the player left the game. Can't be voted for. */
  empty?: 'timeout' | 'left';
}

/** What a player is handed at the current step. */
export interface Task {
  chain: number;
  step: number;
  kind: StepKind;
  /** draw: the sentence to draw ('' if it was empty: draw anything). */
  prompt?: string;
  /** describe: the drawing to describe (maybe blank). */
  pic?: Stroke[];
}

export interface ChainVotes {
  /** Votes per entry. */
  counts: number[];
  /** Points per author for this chain. */
  points: Record<string, number>;
  /** Who voted for each entry. */
  voters: string[][];
}

/**
 * One game of Głuchy Telefon. `seats` is the fixed passing order (chain c belongs to seats[c]);
 * removed players keep their seat, and their steps are filled with placeholders.
 */
export class Telephone {
  readonly steps: number;
  /** chains[c][s]: the entry made at step s of chain c (filled in as the steps go). */
  readonly chains: Entry[][];
  /** The step everyone is working on now (== steps once all are done). */
  step = 0;
  readonly left = new Set<string>();
  /** votes[c]: voter → entry index. */
  readonly votes: Map<string, number>[];

  constructor(
    readonly seats: readonly string[],
    short = false,
  ) {
    this.steps = stepCount(seats.length, short);
    this.chains = seats.map(() => []);
    this.votes = seats.map(() => new Map());
    this.fillLeft();
  }

  get n() {
    return this.seats.length;
  }

  get done() {
    return this.step >= this.steps;
  }

  get kind(): StepKind {
    return stepKind(this.step);
  }

  /** Players still in the game, in seat order. */
  get active(): string[] {
    return this.seats.filter((id) => !this.left.has(id));
  }

  private seatOf(id: string) {
    return this.seats.indexOf(id);
  }

  /** The chain `id` works on at the current step, or -1. */
  chainOf(id: string): number {
    const seat = this.seatOf(id);
    if (seat < 0 || this.done) return -1;
    return chainFor(seat, this.step, this.n);
  }

  /** The entry handed on to step `step` of `chain` (the one before it). */
  private previous(chain: number, step: number): Entry | undefined {
    return step > 0 ? this.chains[chain][step - 1] : undefined;
  }

  /** What `id` has to do now, or null (not playing, removed, or the steps are over). */
  task(id: string): Task | null {
    const chain = this.chainOf(id);
    if (chain < 0 || this.left.has(id)) return null;
    const kind = this.kind;
    const prev = this.previous(chain, this.step);
    const t: Task = { chain, step: this.step, kind };
    if (kind === 'draw') t.prompt = prev && !prev.empty ? (prev.text ?? '') : '';
    if (kind === 'describe') t.pic = prev?.strokes ?? [];
    return t;
  }

  /** The entry `id` made at the current step, if any. */
  current(id: string): Entry | undefined {
    const chain = this.chainOf(id);
    return chain < 0 ? undefined : this.chains[chain][this.step];
  }

  has(id: string): boolean {
    return !!this.current(id);
  }

  /** Players who still have to hand something in at this step. */
  pending(): string[] {
    if (this.done) return [];
    return this.active.filter((id) => !this.has(id));
  }

  /**
   * Hand in `id`'s entry for the current step: a text (write / describe) or a drawing (draw).
   * Returns false if it doesn't fit (wrong kind, already in, removed, nothing usable).
   */
  submit(id: string, a: { text?: unknown; strokes?: unknown; auto?: string }): boolean {
    const t = this.task(id);
    if (!t || this.has(id)) return false;
    let e: Entry;
    if (t.kind === 'draw') {
      const strokes = cleanStrokes(a.strokes);
      if (!strokes) return false;
      e = { by: id, kind: 'draw', strokes };
    } else {
      const auto = t.kind === 'write' && a.auto ? sanitizeText(a.auto) : '';
      const text = auto || sanitizeText(a.text);
      if (!text) return false;
      e = { by: id, kind: t.kind, text, ...(auto ? { auto: true } : {}) };
    }
    this.chains[t.chain][this.step] = e;
    return true;
  }

  /**
   * Time is up: fill in everyone who hasn't handed anything in (a picked sentence on the first step,
   * otherwise an empty drawing or "(no idea)") and move on to the next step.
   */
  endStep(pickSentence: () => string = () => ''): void {
    if (this.done) return;
    for (const id of this.pending()) {
      const chain = this.chainOf(id);
      const kind = this.kind;
      const sentence = kind === 'write' ? sanitizeText(pickSentence()) : '';
      this.chains[chain][this.step] =
        kind === 'draw'
          ? { by: id, kind, strokes: [], empty: 'timeout' }
          : sentence
            ? { by: id, kind, text: sentence, auto: true }
            : { by: id, kind, text: NO_IDEA, empty: 'timeout' };
    }
    this.step++;
    this.fillLeft();
  }

  /** Removed players' steps are filled with a placeholder straight away. */
  private fillLeft() {
    if (this.done) return;
    for (const id of this.left) {
      const chain = this.chainOf(id);
      if (chain < 0 || this.chains[chain][this.step]) continue;
      const kind = this.kind;
      this.chains[chain][this.step] = kind === 'draw' ? { by: id, kind, strokes: [], empty: 'left' } : { by: id, kind, text: LEFT_GAME, empty: 'left' };
    }
  }

  /** A player was removed: skip their steps from now on (an entry they already handed in stays). */
  remove(id: string): void {
    if (this.seatOf(id) < 0) return;
    this.left.add(id);
    this.fillLeft();
  }

  // ---- votes --------------------------------------------------------------------------

  /** Which entries of `chain` `voter` may pick: not their own, not placeholders. */
  canPick(chain: number, voter: string): boolean[] {
    return (this.chains[chain] ?? []).map((e) => e.by !== voter && !e.empty);
  }

  /** `voter` can vote on `chain` at all. */
  canVote(chain: number, voter: string): boolean {
    return !this.left.has(voter) && this.seatOf(voter) >= 0 && this.canPick(chain, voter).some(Boolean);
  }

  /** Players who still have to vote on `chain`. */
  pendingVoters(chain: number): string[] {
    return this.active.filter((id) => this.canVote(chain, id) && !this.votes[chain].has(id));
  }

  vote(chain: number, voter: string, i: unknown): boolean {
    if (!this.canVote(chain, voter) || this.votes[chain].has(voter)) return false;
    if (typeof i !== 'number' || !Number.isInteger(i) || !this.canPick(chain, voter)[i]) return false;
    this.votes[chain].set(voter, i);
    return true;
  }

  /** The votes on one chain. Votes for removed players' entries count, but earn nothing. */
  tally(chain: number): ChainVotes {
    const entries = this.chains[chain] ?? [];
    const counts = entries.map(() => 0);
    const voters: string[][] = entries.map(() => []);
    const points: Record<string, number> = {};
    for (const [voter, i] of this.votes[chain] ?? []) {
      counts[i]++;
      voters[i].push(voter);
      const by = entries[i].by;
      if (!this.left.has(by)) points[by] = (points[by] ?? 0) + TEL_VOTE_POINTS;
    }
    return { counts, points, voters };
  }

  /** Scores so far (the votes on the chains up to `upTo`, all of them by default) for everyone still playing. */
  scores(upTo = this.n - 1): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of this.active) out[id] = 0;
    for (let c = 0; c <= upTo && c < this.n; c++) {
      for (const [id, pts] of Object.entries(this.tally(c).points)) if (id in out) out[id] += pts;
    }
    return out;
  }
}

/** A random seating, so the chains pass in a fresh order each game. */
export function seating(ids: readonly string[], rng: Rng = Math.random): string[] {
  return shuffle([...ids], rng);
}

/** Pick `n` starting sentences not used lately. Mutates `used`. */
export function pickSentences(pool: readonly TelSentence[], used: Set<string>, n: number, rng: Rng = Math.random): string[] {
  return pickQuestions(pool, used, Math.min(n, pool.length), rng).map((s) => s.text);
}

/** How long the TV shows an entry of a chain before moving on. */
export function revealMs(e: Entry | undefined, first = false): number {
  if (!e) return 0;
  if (e.empty) return 2600;
  if (e.kind === 'draw') return e.strokes?.length ? 6500 : 3200;
  return first ? 4200 : 4800;
}

export { shuffle };
