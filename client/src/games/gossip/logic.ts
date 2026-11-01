/**
 * Plotki ("gossip"): our take on Survive the Internet. Everyone answers a harmless question about
 * themselves ("What did you have for breakfast?"). Then each answer goes to someone else, who puts it in
 * a new setting – a newspaper headline, a police report, a dating profile – to make it sound as bad (or
 * as funny) as possible. The room votes for the best twist. Votes score for the twister.
 * Pure rules: no DOM, no timers.
 */
import type { Rng } from '../rng';
import { derange, shuffle } from '../wordkit/logic';

export const GS_ANSWER_MAX = 60;
export const GS_TWIST_MAX = 70;
export const GS_ANSWER_MS = 50_000;
export const GS_TWIST_MS = 60_000;
export const GS_VOTE_MS = 25_000;
/** Extra time on the vote reveal on top of the usual hold: there are many twists and authors to read. */
export const GS_REVEAL_EXTRA_MS = 12_000;
export const GS_ROUNDS = 2;
export const GS_ROUNDS_SHORT = 1;
export const GS_VOTE_POINTS = 100;
export const GS_WIN_BONUS = 200;

export interface GsQuestion {
  id: string;
  q: string;
}

export interface GsContext {
  id: string;
  /** Where the quote turns up ("Police report"). */
  label: string;
  /** What the twister writes. */
  ask: string;
  placeholder: string;
  /** Babcia's lines if the twister runs out of time. */
  fallback: string[];
}

/** Round `round` (1-based) pays this many times the points. */
export function multiplier(round: number): number {
  return Math.max(1, Math.min(2, round));
}

export interface Assignment {
  /** Whose answer this twister gets. */
  from: number;
  /** Index into the contexts. */
  context: number;
}

/**
 * Who twists whose answer, and in which setting: everyone gets someone else's answer (one loop round
 * the room), and the settings are all different while there are enough.
 */
export function assign(n: number, contexts: number, rng: Rng = Math.random): Assignment[] {
  const to = derange(n, rng);
  const ctx = shuffle(
    Array.from({ length: contexts }, (_, k) => k),
    rng,
  );
  return to.map((from, k) => ({ from, context: ctx[k % ctx.length] }));
}

export function howTo(short: boolean): string[] {
  return [
    'Answer a harmless question about yourself',
    'Then twist someone else’s answer into village gossip',
    short ? 'Vote for the best gossip · votes score' : 'Vote for the best gossip · votes score · round 2 ×2',
  ];
}
