/**
 * Fala (Polish for "wave"): our take on Wavelength. Each round one player, the Psychic, sees a secret
 * spot on a spectrum ("Cold ↔ Hot") and gives a one-line clue; everyone else slides a dial to where
 * they think it is. Pure rules and the round state machine – no DOM, so it can be unit-tested.
 */
import type { Rng } from '../rng';
import { pickQuestions } from '../quiz/logic';

export interface Spectrum {
  id: string;
  left: string;
  right: string;
}

/** The Psychic's time to type a clue. */
export const WAVE_CLUE_MS = 45_000;
/** The guessers' time to lock in. */
export const WAVE_GUESS_MS = 30_000;
export const WAVE_CLUE_MAX = 40;
/** What the round plays with when the Psychic gives no clue in time. */
export const NO_CLUE = '(no clue)';
/** Targets stay this far from the ends of the dial. */
export const TARGET_MARGIN = 5;
/** The scoring bands, outermost last: within `d` of the target scores `pts`. */
export const BANDS = [
  { d: 4, pts: 4 },
  { d: 10, pts: 3 },
  { d: 17, pts: 2 },
] as const;

export function howTo(short: boolean): string[] {
  return [
    'The Psychic sees a secret spot on Cold ↔ Hot and gives a clue',
    'Everyone else slides the dial to the spot',
    short ? 'Closer scores more · up to 4 rounds' : 'Closer scores more · everyone is Psychic once or twice',
  ];
}

/** Full game: two turns as Psychic each, 4 to 8 rounds. Short: one turn each, 2 to 4 rounds. */
export function roundsFor(players: number, short = false): number {
  const n = Math.max(1, Math.floor(players));
  return short ? Math.min(4, Math.max(2, n)) : Math.min(8, Math.max(4, 2 * n));
}

/** Who is the Psychic in each round: the players in turn, from the first. */
export function psychicPlan(ids: readonly string[], rounds: number): string[] {
  if (!ids.length) return [];
  return Array.from({ length: rounds }, (_, r) => ids[r % ids.length]);
}

/** A secret target, 5..95. */
export function randomTarget(rng: Rng = Math.random): number {
  const span = 100 - 2 * TARGET_MARGIN;
  return TARGET_MARGIN + Math.min(span, Math.floor(rng() * (span + 1)));
}

/** Points for a guess `d` away from the target: 4 / 3 / 2 / 0. */
export function pointsFor(guess: number, target: number): number {
  const d = Math.abs(guess - target);
  for (const b of BANDS) if (d <= b.d) return b.pts;
  return 0;
}

/** The Psychic scores the rounded average of the guessers' points (0 if nobody guessed). */
export function psychicPoints(points: readonly number[]): number {
  if (!points.length) return 0;
  return Math.max(0, Math.round(points.reduce((a, b) => a + b, 0) / points.length));
}

/** A guess from the phone: a whole number 0..100, or null if it isn't a number. */
export function sanitizeGuess(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** Clean up a typed clue. Returns '' if nothing usable is left. */
export function sanitizeClue(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, WAVE_CLUE_MAX)
    .trim();
}

/** Why a clue is turned down, or null if it's fine: giving away the number is cheating. */
export function clueProblem(clue: string, target: number): string | null {
  if (!clue) return 'Type a clue first.';
  if (new RegExp(`(^|\\D)${target}(\\D|$)`).test(clue)) return 'No giving away the number!';
  return null;
}

/** Spectra for a game: all different, and not ones used recently in this session if possible. */
export function pickSpectra(pool: readonly Spectrum[], used: Set<string>, n: number, rng: Rng = Math.random): Spectrum[] {
  return pickQuestions(pool, used, Math.min(n, pool.length), rng);
}

export interface RoundResult {
  target: number;
  /** Guesser → guess. */
  guesses: Record<string, number>;
  /** Points everyone earned this round (guessers and the Psychic). */
  points: Record<string, number>;
  psychic: string;
}

/** Score a round: every guesser by distance, the Psychic the average of the guessers' points. */
export function scoreRound(target: number, guesses: Readonly<Record<string, number>>, psychic: string): RoundResult {
  const points: Record<string, number> = {};
  const got: number[] = [];
  for (const [id, g] of Object.entries(guesses)) {
    if (id === psychic) continue;
    const p = pointsFor(g, target);
    points[id] = p;
    got.push(p);
  }
  points[psychic] = psychicPoints(got);
  return { target, guesses: { ...guesses }, points, psychic };
}

export type WavePhase = 'intro' | 'clue' | 'guess' | 'reveal' | 'scores' | 'over';

/** What an answer from a phone did. */
export type Answer = 'ok' | 'stale' | 'rejected' | 'ignored';

/**
 * The whole game as a state machine. The game component drives it with timers (`advance` on a
 * timeout) and phone messages; everything that decides who scores what lives here.
 */
export class WaveMatch {
  ids: string[];
  /** The Psychic of each remaining round, by round index. Removed players' rounds are dropped. */
  plan: string[];
  readonly spectra: Spectrum[];
  phase: WavePhase = 'intro';
  /** Round index into `plan` (−1 before the first). */
  ri = -1;
  /** Changes with every question, so late answers to an old one are ignored. */
  key = 0;
  target = 50;
  clue: string | null = null;
  clueError: string | null = null;
  guesses = new Map<string, number>();
  scores: Record<string, number> = {};
  result: RoundResult | null = null;
  /** Rounds actually played to the end. */
  played = 0;

  constructor(
    ids: readonly string[],
    opts: { short?: boolean; pool: readonly Spectrum[]; used?: Set<string>; rng?: Rng },
    private rng: Rng = opts.rng ?? Math.random,
  ) {
    this.ids = [...ids];
    const rounds = roundsFor(ids.length, opts.short);
    this.plan = psychicPlan(this.ids, rounds);
    this.spectra = pickSpectra(opts.pool, opts.used ?? new Set(), rounds, this.rng);
    for (const id of ids) this.scores[id] = 0;
  }

  get rounds() {
    return this.plan.length;
  }
  get psychic(): string {
    return this.plan[this.ri] ?? '';
  }
  get spectrum(): Spectrum {
    return this.spectra[this.ri % Math.max(1, this.spectra.length)] ?? { id: '-', left: 'Left', right: 'Right' };
  }
  get guessers(): string[] {
    return this.ids.filter((id) => id !== this.psychic);
  }
  get isLast() {
    return this.ri >= this.plan.length - 1;
  }

  /** On to the next round's intro, or 'over' when there are no rounds (or not enough players) left. */
  nextRound(): WavePhase {
    this.result = null;
    this.clue = null;
    this.clueError = null;
    this.guesses.clear();
    if (this.ids.length < 2 || this.ri + 1 >= this.plan.length) {
      this.phase = 'over';
      return this.phase;
    }
    this.ri++;
    this.target = randomTarget(this.rng);
    this.phase = 'intro';
    return this.phase;
  }

  /** Move on when the current phase's time is up (or everyone is done). */
  advance(): WavePhase {
    switch (this.phase) {
      case 'intro':
        this.phase = 'clue';
        this.key++;
        break;
      case 'clue':
        if (this.clue === null) this.clue = NO_CLUE;
        this.phase = 'guess';
        this.key++;
        break;
      case 'guess':
        this.reveal();
        break;
      case 'reveal':
        this.phase = 'scores';
        break;
      case 'scores':
        return this.nextRound();
      case 'over':
        break;
    }
    return this.phase;
  }

  private reveal() {
    this.result = scoreRound(this.target, Object.fromEntries(this.guesses), this.psychic);
    for (const [id, pts] of Object.entries(this.result.points)) if (id in this.scores) this.scores[id] += pts;
    this.played++;
    this.phase = 'reveal';
  }

  /** The Psychic's clue. */
  submitClue(id: string, key: number, raw: unknown): Answer {
    if (this.phase !== 'clue' || id !== this.psychic || this.clue !== null) return 'ignored';
    if (key !== this.key) return 'stale';
    const clue = sanitizeClue(raw);
    const problem = clueProblem(clue, this.target);
    if (problem) {
      this.clueError = problem;
      return 'rejected';
    }
    this.clue = clue;
    this.clueError = null;
    return 'ok';
  }

  /** A guesser locks in. One guess each, and the Psychic can't guess. */
  submitGuess(id: string, key: number, raw: unknown): Answer {
    if (this.phase !== 'guess' || id === this.psychic || !this.ids.includes(id) || this.guesses.has(id)) return 'ignored';
    if (key !== this.key) return 'stale';
    const n = sanitizeGuess(raw);
    if (n === null) return 'rejected';
    this.guesses.set(id, n);
    return 'ok';
  }

  /** Everyone who is still here and connected has locked in. */
  allGuessed(connected: (id: string) => boolean = () => true): boolean {
    const active = this.guessers.filter(connected);
    return active.length > 0 && active.every((id) => this.guesses.has(id));
  }

  /**
   * A player left the game. Their later turns as Psychic are dropped; if it was their turn and the
   * round hadn't been scored yet, the round is called off (`aborted`: move straight to the next one).
   */
  remove(id: string): { aborted: boolean } {
    if (!this.ids.includes(id)) return { aborted: false };
    const wasPsychic = id === this.psychic;
    this.ids = this.ids.filter((x) => x !== id);
    delete this.scores[id];
    this.guesses.delete(id);
    this.plan = this.plan.filter((p, i) => i <= this.ri || p !== id);
    const aborted = wasPsychic && (this.phase === 'intro' || this.phase === 'clue' || this.phase === 'guess');
    if (aborted) {
      // Drop the called-off round from the plan too, so the round count stays honest.
      this.plan.splice(this.ri, 1);
      this.spectraSkip();
      this.ri--;
    }
    return { aborted };
  }

  /** Keep the called-off round's spectrum out of the game (no repeats): later rounds shift down one. */
  private spectraSkip() {
    this.spectra.splice(this.ri, 1);
  }
}
