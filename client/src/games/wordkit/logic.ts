/**
 * Shared rules for the newer Jackbox-style games (Ankieta, Pół na Pół, Słownik, Plotki): cleaning up
 * typed text, scoring a vote for one of many entries, and handing everyone someone else's answer.
 * Pure: no DOM, no timers.
 */
import type { Rng } from '../rng';
import { shuffle } from '../quiz/logic';
import { answerKey } from '../quip/logic';

export { answerKey, shuffle };

/** Clean up typed text: one line, no control characters or angle brackets, at most `max` characters. '' if nothing's left. */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, max)
    .trim();
}

/** Round to the nearest 50 (scores read better that way). */
export const round50 = (n: number) => Math.round(n / 50) * 50;

/** Pick one at random. */
export function pick<T>(list: readonly T[], rng: Rng = Math.random): T {
  return list[Math.floor(rng() * list.length)];
}

/** A line from `pool` that isn't in `taken` yet (compared loosely), if there is one. */
export function freshLine(pool: readonly string[], taken: Iterable<string>, rng: Rng = Math.random): string {
  const keys = new Set([...taken].map(answerKey));
  const fresh = pool.filter((s) => !keys.has(answerKey(s)));
  return pick(fresh.length ? fresh : pool, rng);
}

export interface VoteResult {
  /** Who voted for each entry, in voting order. */
  voters: string[][];
  /** Points per author (every author present, 0 if no votes). */
  points: Record<string, number>;
  /** Entries with the most votes (none if nobody voted). */
  winners: number[];
}

/**
 * Score a vote for one of many entries. `authors[i]` wrote entry i; `votes` maps voter → entry.
 * Votes for your own entry, or for an entry that isn't there, don't count. Each vote is worth
 * `perVote` to the author, and the entries with the most votes get `bonus` on top.
 */
export function scoreVotes(authors: readonly string[], votes: Record<string, number>, perVote: number, bonus = 0): VoteResult {
  const voters: string[][] = authors.map(() => []);
  const points: Record<string, number> = {};
  for (const a of authors) points[a] = 0;
  for (const [voter, i] of Object.entries(votes)) {
    if (!Number.isInteger(i) || i < 0 || i >= authors.length || authors[i] === voter) continue;
    voters[i].push(voter);
  }
  voters.forEach((v, i) => (points[authors[i]] += v.length * perVote));
  const top = Math.max(0, ...voters.map((v) => v.length));
  const winners = top > 0 ? voters.flatMap((v, i) => (v.length === top ? [i] : [])) : [];
  for (const i of winners) points[authors[i]] += bonus;
  return { voters, points, winners };
}

/** Can `voter` vote for entry `i`? (Not their own, and it has to exist.) */
export function canVote(voter: string, authors: readonly string[], i: unknown): i is number {
  return typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < authors.length && authors[i] !== voter;
}

/**
 * Hand everyone someone else's thing: returns `to` where `ids[k]` gets the item of `ids[to[k]]`,
 * never their own (with two or more players). A shuffled ring, so it's a single loop round the room.
 */
export function derange(n: number, rng: Rng = Math.random): number[] {
  if (n < 2) return n === 1 ? [0] : [];
  const ring = shuffle(
    Array.from({ length: n }, (_, k) => k),
    rng,
  );
  const to = new Array<number>(n);
  ring.forEach((k, j) => (to[k] = ring[(j + 1) % n]));
  return to;
}
