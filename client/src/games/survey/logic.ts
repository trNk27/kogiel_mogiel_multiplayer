/**
 * Ankieta ("the survey"): our take on Guesspionage, about the people in the room. Everyone secretly
 * answers a yes/no question. Then one player, the surveyor, guesses how many said yes, and everyone else
 * bets whether the real number is more, exactly that, or fewer. Everyone takes a turn as the surveyor.
 * Pure rules: no DOM, no timers.
 */
import type { Rng } from '../rng';
import { round50, shuffle } from '../wordkit/logic';

export const SV_ANSWER_MS = 15_000;
export const SV_GUESS_MS = 20_000;
export const SV_BET_MS = 12_000;
/** Most rounds in a full game (one per player up to this), and in a tournament. */
export const SV_MAX_ROUNDS = 6;
export const SV_MAX_ROUNDS_SHORT = 3;
/** The surveyor's points for a spot-on guess (less the further off; see `guessPoints`). */
export const SV_GUESS_POINTS = 1000;
/** A right "more" or "fewer" bet, and a right "exactly" bet. */
export const SV_SIDE_POINTS = 300;
export const SV_EXACT_POINTS = 600;

export interface SvQuestion {
  id: string;
  q: string;
}

/** 0: more than the guess, 1: exactly the guess, 2: fewer than the guess. */
export type Bet = 0 | 1 | 2;

export function roundsFor(players: number, short: boolean): number {
  return Math.max(1, Math.min(players, short ? SV_MAX_ROUNDS_SHORT : SV_MAX_ROUNDS));
}

/** Who guesses in each round: everyone once in a shuffled order (round-robin if there are more rounds than players). */
export function surveyors(ids: readonly string[], rounds: number, rng: Rng = Math.random): string[] {
  const order = shuffle(ids, rng);
  return Array.from({ length: rounds }, (_, k) => order[k % order.length]);
}

/**
 * The surveyor's points: SV_GUESS_POINTS when spot on, losing 2.5 × the share of the room they're off
 * by (so being one off matters less in a big room), rounded to 50.
 */
export function guessPoints(guess: number, yes: number, total: number): number {
  if (total <= 0) return 0;
  const off = Math.abs(guess - yes) / total;
  return round50(SV_GUESS_POINTS * Math.max(0, 1 - 2.5 * off));
}

/** Was a bet right? */
export function betRight(bet: Bet, guess: number, yes: number): boolean {
  return bet === 0 ? yes > guess : bet === 2 ? yes < guess : yes === guess;
}

/** Which bets make sense: "more" can't win if the guess is everyone, "fewer" can't if it's nobody. */
export function betOff(guess: number, total: number): [boolean, boolean, boolean] {
  return [guess >= total, false, guess <= 0];
}

export interface RoundResult {
  yes: number;
  total: number;
  guess: number;
  /** Points per player (the surveyor and every bettor). */
  points: Record<string, number>;
  /** Each bettor's bet and whether it was right. */
  bets: Record<string, { bet: Bet; right: boolean }>;
}

/**
 * Score a round. `answers` maps player → yes (true) or no; players who didn't answer don't count.
 * Bets from the surveyor, or that aren't 0–2, are ignored.
 */
export function scoreRound(surveyor: string, guess: number, answers: Record<string, boolean>, bets: Record<string, number>): RoundResult {
  const vals = Object.values(answers);
  const total = vals.length;
  const yes = vals.filter(Boolean).length;
  const g = Math.max(0, Math.min(total, Math.round(Number(guess) || 0)));
  const points: Record<string, number> = { [surveyor]: guessPoints(g, yes, total) };
  const out: RoundResult['bets'] = {};
  for (const [id, b] of Object.entries(bets)) {
    if (id === surveyor || (b !== 0 && b !== 1 && b !== 2)) continue;
    const right = total > 0 && betRight(b, g, yes);
    out[id] = { bet: b, right };
    points[id] = (points[id] ?? 0) + (right ? (b === 1 ? SV_EXACT_POINTS : SV_SIDE_POINTS) : 0);
  }
  return { yes, total, guess: g, points, bets: out };
}

export function betLabel(bet: Bet, guess: number): string {
  return bet === 0 ? `More than ${guess}` : bet === 1 ? `Exactly ${guess}` : `Fewer than ${guess}`;
}

export function howTo(short: boolean): string[] {
  return [
    'Answer a yes/no question on your phone – in secret',
    'The surveyor guesses how many said yes',
    short ? 'Everyone else bets: more, exactly or fewer? · 3 rounds' : 'Everyone else bets: more, exactly or fewer? · everyone guesses once',
  ];
}
