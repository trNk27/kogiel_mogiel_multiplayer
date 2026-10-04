import type { BetSlot } from '../../../../shared/protocol';

export interface BallparkQuestion {
  id: string;
  question: string;
  answer: number;
  unit: string;
}

export const BP_QUESTIONS_PER_GAME = 7;
export const BP_GUESS_MS = 40_000;
export const BP_BET_MS = 25_000;
/** Points for having the winning guess. */
export const BP_GUESS_POINTS = 300;
/** Extra points for nailing the exact answer. */
export const BP_BULLSEYE_BONUS = 200;
/** A correct bet pays this many points times the slot's payout. */
export const BP_BET_STAKE = 100;

export interface Guess {
  id: string;
  name: string;
  value: number;
}

/**
 * Build the betting board: one slot per distinct guess (ascending) plus a leading
 * "smaller than every guess" slot. Payouts grow towards the edges, like Wits & Wagers:
 * middle guesses pay 2×, each step outwards +1 (max 5×), and the "smaller" slot pays the most.
 */
export function buildSlots(guesses: Guess[]): BetSlot[] {
  const values = [...new Set(guesses.map((g) => g.value))].sort((a, b) => a - b);
  const centre = (values.length - 1) / 2;
  const slots: BetSlot[] = values.map((value, i) => ({
    value,
    payout: Math.min(5, 2 + Math.floor(Math.abs(i - centre))),
    guessers: guesses.filter((g) => g.value === value).map((g) => g.name),
  }));
  const edge = Math.min(6, Math.max(3, ...slots.map((s) => s.payout + 1)));
  return [{ value: null, payout: edge, guessers: [] }, ...slots];
}

/** Index of the winning slot: the largest guess that does not go over the answer. */
export function winningSlot(slots: BetSlot[], answer: number): number {
  let win = 0;
  slots.forEach((s, i) => {
    if (s.value !== null && s.value <= answer) win = i;
  });
  return win;
}

export interface RoundScore {
  guessWon: boolean;
  bullseye: boolean;
  betWon: boolean;
  points: number;
}

/** Score one Ballpark question for every player. */
export function scoreBallpark(
  players: string[],
  guesses: Guess[],
  bets: Record<string, number | undefined>,
  slots: BetSlot[],
  answer: number,
): Record<string, RoundScore> {
  const win = winningSlot(slots, answer);
  const winValue = slots[win].value;
  const out: Record<string, RoundScore> = {};
  for (const id of players) {
    const g = guesses.find((x) => x.id === id);
    const guessWon = !!g && winValue !== null && g.value === winValue;
    const bullseye = guessWon && g!.value === answer;
    const betWon = bets[id] === win;
    const points = (guessWon ? BP_GUESS_POINTS : 0) + (bullseye ? BP_BULLSEYE_BONUS : 0) + (betWon ? BP_BET_STAKE * slots[win].payout : 0);
    out[id] = { guessWon, bullseye, betWon, points };
  }
  return out;
}

export { formatNumber } from '../../../../shared/format';
