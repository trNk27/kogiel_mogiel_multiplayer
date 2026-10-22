/**
 * Minutnik: pure rules. No DOM, no three.js.
 *
 * Each round has a target ("Stop at exactly 7 seconds!"). At GO the tomato kitchen timer starts and
 * ticks where everyone can see it, then after SHOW_MS Babcia throws her tea towel over it and the rest
 * is in your head. Every player presses STOP once; the press is timed on the host's clock when the
 * message arrives, relative to GO. Whoever hasn't pressed by target + TIMEOUT_S is timed out.
 *
 * Presses before GO are ignored (the STOP button is greyed out during the countdown anyway, so one only
 * gets through by racing the countdown) and don't lock you in. Extra presses after the first are ignored.
 */
import { mulberry32, type Rng } from '../rng';

export { mulberry32 };
export type { Rng };

/** Full game / tournament version. */
export const CLOCK_ROUNDS = 5;
export const CLOCK_ROUNDS_SHORT = 3;

/** How long the timer is visible (and ticking) after GO, ms. */
export const SHOW_MS = 2500;
/** Seconds after the target before a player who hasn't pressed is timed out. */
export const TIMEOUT_S = 6;
/** Within this many ms of the target counts as spot on. */
export const PERFECT_MS = 100;
export const PERFECT_PTS = 10;
/** Off by e seconds (and not spot on): max(0, round(BASE_PTS − 10·|e|)). */
export const BASE_PTS = 8;
/** For the closest, second and third closest (ties share). Not on your own. */
export const BONUS = [3, 2, 1];

/**
 * Targets in seconds, by stage of the game: early rounds are short, later ones longer. A game picks
 * one target from each stage it reaches, always longer than the last one.
 */
export const TIERS: number[][] = [
  [5, 6, 7],
  [7, 8, 10],
  [10, 12],
  [12, 15],
  [15, 20],
];
export const ALL_TARGETS = [...new Set(TIERS.flat())].sort((a, b) => a - b);

/** The targets for a game of `rounds` rounds: increasing, from short to long. Deterministic for a given rng. */
export function targetsFor(rounds: number, rng: Rng): number[] {
  const out: number[] = [];
  const last = TIERS.length - 1;
  for (let k = 0; k < rounds; k++) {
    const tier = rounds === 1 ? TIERS[2] : TIERS[Math.min(last, Math.round((k * last) / Math.max(1, rounds - 1)))];
    const prev = out.length ? out[out.length - 1] : 0;
    const options = tier.filter((t) => t > prev);
    out.push(options.length ? options[Math.floor(rng() * options.length)] : prev + 2);
  }
  return out;
}

/** Points for being off by `errMs` (either way), before the closeness bonus. */
export function basePoints(errMs: number): number {
  const e = Math.abs(errMs);
  if (e <= PERFECT_MS) return PERFECT_PTS;
  return Math.max(0, Math.round(BASE_PTS - e / 100));
}

/**
 * Competition ranks by closeness (1, 1, 3…): `errs[i]` is |error| in ms, or null for no press.
 * Returns null for those without a press.
 */
export function closenessRanks(errs: (number | null)[]): (number | null)[] {
  return errs.map((e) => (e === null ? null : 1 + errs.filter((o) => o !== null && o < e).length));
}

export type PressResult = 'ok' | 'early' | 'again' | 'late' | 'gone' | 'bad';

export interface PlayerResult {
  /** When they pressed, ms after GO; null if they didn't (timed out, or left). */
  ms: number | null;
  /** Signed error in ms (negative = early); null without a press. */
  err: number | null;
  base: number;
  bonus: number;
  pts: number;
  perfect: boolean;
  /** 1 = closest (shared on a tie); null without a press. */
  rank: number | null;
  timedOut: boolean;
  gone: boolean;
}

export interface RoundResult {
  players: PlayerResult[];
  /** The closest player(s), who get the crown. */
  winners: number[];
  solo: boolean;
}

/** One round: who pressed when. Times are host clock ms (Date.now()). */
export class ClockRound {
  /** ms after GO, or null. */
  readonly presses: (number | null)[];
  readonly gone: boolean[];
  goAt: number | null = null;

  constructor(
    readonly n: number,
    /** Seconds. */
    readonly target: number,
    gone: boolean[] = [],
  ) {
    this.presses = Array.from({ length: n }, () => null);
    this.gone = Array.from({ length: n }, (_, i) => !!gone[i]);
  }

  /** Playing on your own (no closeness bonus). */
  get solo() {
    return this.live().length <= 1;
  }

  begin(at: number) {
    this.goAt = at;
  }

  /** Host clock ms after which nobody can press any more. */
  get deadline(): number {
    return (this.goAt ?? Infinity) + (this.target + TIMEOUT_S) * 1000;
  }

  live(): number[] {
    return this.gone.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
  }

  pressed(i: number) {
    return this.presses[i] !== null && this.presses[i] !== undefined;
  }

  /** Player i pressed STOP at host time `at`. */
  press(i: number, at: number): PressResult {
    if (i < 0 || i >= this.n || !Number.isFinite(at)) return 'bad';
    if (this.gone[i]) return 'gone';
    if (this.goAt === null || at < this.goAt) return 'early';
    if (this.pressed(i)) return 'again';
    if (at > this.deadline) return 'late';
    this.presses[i] = Math.round(at - this.goAt);
    return 'ok';
  }

  remove(i: number) {
    if (i < 0 || i >= this.n) return;
    this.gone[i] = true;
    this.presses[i] = null;
  }

  /**
   * Everybody's in: every live player has pressed, or is offline (`connected[i]` false). Needs at least
   * one press, so a Wi-Fi blip that drops everyone doesn't end the round on the spot.
   */
  allIn(connected: boolean[] = []): boolean {
    const live = this.live();
    if (!live.length) return true;
    if (!live.some((i) => this.pressed(i))) return false;
    return live.every((i) => this.pressed(i) || connected[i] === false);
  }

  /** Done: everybody's in, or past the deadline. */
  done(now: number, connected: boolean[] = []): boolean {
    return now >= this.deadline || this.allIn(connected);
  }

  results(): RoundResult {
    const solo = this.solo;
    const errs = this.presses.map((p, i) => (p === null || this.gone[i] ? null : Math.abs(p - this.target * 1000)));
    const ranks = closenessRanks(errs);
    const players = this.presses.map((p, i): PlayerResult => {
      const gone = this.gone[i];
      if (gone || p === null) return { ms: null, err: null, base: 0, bonus: 0, pts: 0, perfect: false, rank: null, timedOut: !gone, gone };
      const err = p - this.target * 1000;
      const base = basePoints(err);
      const rank = ranks[i]!;
      const bonus = solo ? 0 : (BONUS[rank - 1] ?? 0);
      return { ms: p, err, base, bonus, pts: base + bonus, perfect: Math.abs(err) <= PERFECT_MS, rank, timedOut: false, gone };
    });
    const winners = players.map((r, i) => (r.rank === 1 ? i : -1)).filter((i) => i >= 0);
    return { players, winners, solo };
  }
}

// ---- the reveal ruler -----------------------------------------------------------------------------

/** The stretch of seconds the reveal ruler shows: whole seconds around the target and every press. */
export function rulerRange(target: number, pressMs: (number | null)[]): { lo: number; hi: number } {
  const ts = pressMs.filter((p): p is number => p !== null).map((p) => p / 1000);
  const min = Math.min(target, ...ts);
  const max = Math.max(target, ...ts);
  let lo = Math.max(0, Math.floor(min - 1.5));
  let hi = Math.ceil(max + 1.5);
  // At least 6 s wide, so a single press right on the target still looks like a ruler.
  while (hi - lo < 6) {
    if (lo > 0) lo--;
    hi++;
  }
  return { lo, hi };
}

/**
 * Stack flags so their labels don't overlap: `xs` are positions (any unit), `w` a label's width.
 * Returns a lane (0 = lowest) for each.
 */
export function flagLanes(xs: number[], w: number): number[] {
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const laneEnd: number[] = [];
  const lanes = xs.map(() => 0);
  for (const i of order) {
    let lane = laneEnd.findIndex((end) => end <= xs[i]);
    if (lane < 0) lane = laneEnd.length;
    laneEnd[lane] = xs[i] + w;
    lanes[i] = lane;
  }
  return lanes;
}

/** "0.23 s late", "0.40 s early", "spot on". */
export function errLabel(errMs: number): string {
  if (Math.abs(errMs) < 5) return 'spot on';
  return `${(Math.abs(errMs) / 1000).toFixed(2)} s ${errMs < 0 ? 'early' : 'late'}`;
}

/** Seconds to two places: 7234 → "7.23". */
export const secs = (ms: number) => (ms / 1000).toFixed(2);

export function howTo(short: boolean): string[] {
  return [
    'Watch the timer tick… then Babcia covers it',
    'Tap STOP when you think the time is up',
    short ? 'Three rounds · closest to the target wins' : 'Five rounds · closest to the target wins',
  ];
}
