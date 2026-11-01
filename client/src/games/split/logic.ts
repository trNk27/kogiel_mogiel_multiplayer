/**
 * Pół na Pół ("half and half"): our take on Split the Room. Everyone gets a dilemma with a blank in it
 * ("You can fly, but ___. Would you take the power?") and fills it in on their phone. Then the dilemmas
 * go up one by one and everyone else votes yes or no. The author scores for how evenly the room splits:
 * a perfect half-and-half is worth the most, everyone agreeing is worth nothing.
 * Pure rules: no DOM, no timers.
 */
import { round50 } from '../wordkit/logic';

export const PN_MAX = 60;
export const PN_WRITE_MS = 75_000;
export const PN_WRITE_MS_SHORT = 60_000;
export const PN_VOTE_MS = 15_000;
export const PN_ROUNDS = 2;
export const PN_ROUNDS_SHORT = 1;
/** Points for a perfect split (times the round's multiplier). */
export const PN_SPLIT_POINTS = 1000;

export interface PnScenario {
  id: string;
  /** With exactly one "___" for the player to fill in. */
  text: string;
  /** The question the room votes on. */
  ask: string;
}

/** Round `round` (1-based) pays this many times the points. */
export function multiplier(round: number): number {
  return Math.max(1, Math.min(2, round));
}

/** The dilemma around the blank: [before, after]. */
export function splitAround(text: string): [string, string] {
  const k = text.indexOf('___');
  return k < 0 ? [text, ''] : [text.slice(0, k), text.slice(k + 3)];
}

/** The filled-in dilemma as one line. A trailing full stop in the answer isn't doubled. */
export function filled(text: string, answer: string): string {
  const [a, b] = splitAround(text);
  const ans = b.startsWith('.') ? answer.replace(/[.!]+$/, '') : answer;
  return `${a}${ans}${b}`;
}

/**
 * The author's points: PN_SPLIT_POINTS × the round's multiplier for a perfect split, less as it gets
 * lopsided (the smaller side over the most it could be), rounded to 50. With fewer than two voters
 * there's nothing to split.
 */
export function splitPoints(yes: number, voters: number, mult = 1): number {
  if (voters < 2) return 0;
  const small = Math.min(yes, voters - yes);
  return round50((PN_SPLIT_POINTS * mult * small) / Math.floor(voters / 2));
}

export interface SplitResult {
  yes: string[];
  no: string[];
  points: number;
  /** As even as it can be. */
  perfect: boolean;
}

/** Count a dilemma's votes (`true` = yes); the author's own vote doesn't count. */
export function scoreSplit(author: string, votes: Record<string, boolean>, mult = 1): SplitResult {
  const yes: string[] = [];
  const no: string[] = [];
  for (const [id, v] of Object.entries(votes)) {
    if (id === author) continue;
    (v ? yes : no).push(id);
  }
  const n = yes.length + no.length;
  return { yes, no, points: splitPoints(yes.length, n, mult), perfect: n >= 2 && Math.min(yes.length, no.length) === Math.floor(n / 2) };
}

export function howTo(short: boolean): string[] {
  return [
    'Fill in the blank in your dilemma on your phone',
    'Everyone else votes: yes or no?',
    short ? 'Points for splitting the room half-and-half' : 'Points for splitting the room half-and-half · round 2 ×2',
  ];
}
