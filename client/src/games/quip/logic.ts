/**
 * Riposta: our take on Quiplash. Every round each player answers two prompts, and every prompt goes
 * to two players. The TV shows each matchup and everyone else votes for the funnier answer. The last
 * round, Ostatnia Riposta, gives everyone the same prompt and three votes to spread.
 * Pure rules: no DOM, no timers.
 */
import type { Rng } from '../rng';
import { pickQuestions, shuffle } from '../quiz/logic';

export interface QpPrompt {
  id: string;
  prompt: string;
}

/** Longest answer, in characters. */
export const QP_MAX = 45;
export const QP_WRITE_MS = 80_000;
export const QP_WRITE_MS_SHORT = 60_000;
export const QP_FINAL_WRITE_MS = 45_000;
export const QP_VOTE_MS = 15_000;
export const QP_FINAL_VOTE_MS = 30_000;
/** Points per vote (times the round's multiplier). */
export const QP_VOTE_POINTS = 100;
/** Bonus for taking every vote of a matchup (at least QP_RIPOSTA_MIN of them). */
export const QP_RIPOSTA_BONUS = 250;
export const QP_RIPOSTA_MIN = 2;
/** Ostatnia Riposta: votes per player, and what each one is worth. */
export const QP_FINAL_VOTES = 3;
export const QP_FINAL_MULT = 3;

export interface QpLayout {
  /** Matchup rounds before the final. */
  rounds: number;
  writeMs: number;
}

/** Full game: two rounds (the second pays double) and the final. Tournament: one round and the final. */
export function layoutFor(short: boolean): QpLayout {
  return short ? { rounds: 1, writeMs: QP_WRITE_MS_SHORT } : { rounds: 2, writeMs: QP_WRITE_MS };
}

/** Round `round` (1-based) pays this many times the points. */
export function multiplier(round: number): number {
  return Math.max(1, Math.min(2, round));
}

export function howTo(short: boolean): string[] {
  return [
    'Answer two prompts on your phone – be funny',
    'Vote for the funnier answer · all the votes = RIPOSTA!',
    short ? 'One round + Ostatnia Riposta (votes ×3)' : 'Two rounds (the 2nd ×2) + Ostatnia Riposta (×3)',
  ];
}

// ---- text ------------------------------------------------------------------------

/** Clean up a typed answer. Returns '' if nothing usable is left. */
export function sanitizeAnswer(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, QP_MAX)
    .trim();
}

/**
 * How answers compare: lower case, no accents, no punctuation, no "a", "an" or "the".
 * "The Haunted toaster!" and "a haunted toaster" are the same answer (a jinx).
 */
export function answerKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && w !== 'a' && w !== 'an' && w !== 'the')
    .join(' ');
}

/** A safety answer for "🎲 Answer for me" (or a timeout) that nobody has given yet, if there is one. */
export function safetyAnswer(pool: readonly string[], taken: Iterable<string>, rng: Rng = Math.random): string {
  const keys = new Set([...taken].map(answerKey));
  const fresh = pool.filter((s) => !keys.has(answerKey(s)));
  const from = fresh.length ? fresh : pool;
  return from[Math.floor(rng() * from.length)] ?? 'A haunted wardrobe';
}

/** Pick `n` prompts nobody has seen this session. Mutates `used`. */
export function pickPrompts(pool: readonly QpPrompt[], used: Set<string>, n: number, rng: Rng = Math.random): string[] {
  return pickQuestions(pool, used, n, rng).map((p) => p.prompt);
}

// ---- pairing ---------------------------------------------------------------------

export type Pair = [string, string];

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Who answers which prompt: one prompt per player, each shared by two neighbours in a shuffled ring,
 * so everybody gets two prompts against two different opponents (with 3 or more players). With two
 * players both prompts go to both. Tries a few rings to avoid pairs listed in `avoid` (last round's).
 */
export function pairUp(ids: readonly string[], rng: Rng = Math.random, avoid: ReadonlySet<string> = new Set()): Pair[] {
  if (ids.length < 2) return [];
  let best: Pair[] = [];
  let bestRepeats = Infinity;
  for (let t = 0; t < 40 && bestRepeats > 0; t++) {
    const ring = shuffle(ids, rng);
    const pairs: Pair[] = ring.map((id, i) => [id, ring[(i + 1) % ring.length]]);
    const repeats = pairs.filter(([a, b]) => avoid.has(pairKey(a, b))).length;
    if (repeats < bestRepeats) {
      best = pairs;
      bestRepeats = repeats;
    }
  }
  return best;
}

/** The prompts (indices into `pairs`) a player answers. */
export function slotsFor(id: string, pairs: readonly Pair[]): number[] {
  return pairs.flatMap((p, i) => (p.includes(id) ? [i] : []));
}

/** The order the TV shows the matchups in: shuffled, avoiding the same author twice in a row where possible. */
export function orderMatchups(pairs: readonly Pair[], rng: Rng = Math.random): number[] {
  const left = shuffle(
    pairs.map((_, i) => i),
    rng,
  );
  const out: number[] = [];
  while (left.length) {
    const prev = out.length ? pairs[out[out.length - 1]] : null;
    let k = prev ? left.findIndex((i) => !pairs[i].some((a) => prev.includes(a))) : 0;
    if (k < 0) k = 0;
    out.push(left.splice(k, 1)[0]);
  }
  return out;
}

// ---- scoring ---------------------------------------------------------------------

export interface MatchupResult {
  /** The two answers are the same: nobody scores. */
  jinx: boolean;
  /** Who voted for each answer, in voting order. */
  voters: [string[], string[]];
  /** Points per author (both always present unless it's the same player). */
  points: Record<string, number>;
  /** The side that took every vote (and at least QP_RIPOSTA_MIN), if any. */
  riposta: 0 | 1 | null;
  /** The side with more votes; null on a tie or with no votes. */
  winner: 0 | 1 | null;
}

/**
 * Score one matchup. `votes` maps voter → 0 or 1; the authors' own votes and anything else are
 * ignored. `mult` is the round's multiplier.
 */
export function scoreMatchup(texts: readonly [string, string], authors: readonly [string, string], votes: Record<string, number>, mult = 1): MatchupResult {
  const voters: [string[], string[]] = [[], []];
  const points: Record<string, number> = { [authors[0]]: 0, [authors[1]]: 0 };
  const jinx = answerKey(texts[0]) === answerKey(texts[1]);
  if (jinx) return { jinx, voters, points, riposta: null, winner: null };
  for (const [voter, side] of Object.entries(votes)) {
    if (authors.includes(voter) || (side !== 0 && side !== 1)) continue;
    voters[side].push(voter);
  }
  const [a, b] = [voters[0].length, voters[1].length];
  const riposta = a + b >= QP_RIPOSTA_MIN && (a === 0 || b === 0) ? (a > 0 ? 0 : 1) : null;
  for (const side of [0, 1] as const) {
    points[authors[side]] += voters[side].length * QP_VOTE_POINTS * mult + (riposta === side ? QP_RIPOSTA_BONUS * mult : 0);
  }
  return { jinx, voters, points, riposta, winner: a > b ? 0 : b > a ? 1 : null };
}

export interface FinalEntry {
  author: string;
  text: string;
}

/** Final answers that match another one: jinxed, they can't be voted for. */
export function finalJinxed(entries: readonly FinalEntry[]): boolean[] {
  const keys = entries.map((e) => answerKey(e.text));
  return keys.map((k) => keys.filter((o) => o === k).length > 1);
}

/** Can `voter`, who already picked `picks`, give a vote to entry `i`? */
export function canPickFinal(voter: string, entries: readonly FinalEntry[], jinxed: readonly boolean[], picks: readonly number[], i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < entries.length && entries[i].author !== voter && !jinxed[i] && !picks.includes(i) && picks.length < QP_FINAL_VOTES;
}

/** How many votes `voter` can give: three, or fewer if there aren't three answers to give them to. */
export function finalVotesFor(voter: string, entries: readonly FinalEntry[], jinxed: readonly boolean[]): number {
  return Math.min(QP_FINAL_VOTES, entries.filter((e, i) => e.author !== voter && !jinxed[i]).length);
}

export interface FinalResult {
  /** Who voted for each entry. */
  voters: string[][];
  /** Points per author. */
  points: Record<string, number>;
  /** Entries with the most votes (none if nobody voted). */
  winners: number[];
}

/** Score Ostatnia Riposta. `votes` maps voter → the entries they picked, in order; invalid picks are dropped. */
export function scoreFinal(entries: readonly FinalEntry[], votes: Record<string, readonly number[]>, mult = QP_FINAL_MULT): FinalResult {
  const jinxed = finalJinxed(entries);
  const voters: string[][] = entries.map(() => []);
  const points: Record<string, number> = {};
  for (const e of entries) points[e.author] = 0;
  for (const [voter, picks] of Object.entries(votes)) {
    const valid: number[] = [];
    for (const i of picks) if (canPickFinal(voter, entries, jinxed, valid, i)) valid.push(i);
    for (const i of valid) {
      voters[i].push(voter);
      points[entries[i].author] += QP_VOTE_POINTS * mult;
    }
  }
  const top = Math.max(0, ...voters.map((v) => v.length));
  const winners = top > 0 ? voters.flatMap((v, i) => (v.length === top ? [i] : [])) : [];
  return { voters, points, winners };
}

// ---- timing ----------------------------------------------------------------------

/** On the matchup reveal: when voter pierogi start popping onto the answers, and how far apart. */
export const QP_POP_START_MS = 700;
export const QP_POP_STEP_MS = 380;

/** When the authors are revealed (ms after the reveal starts), given the number of votes. */
export function authorsAt(votes: number): number {
  return QP_POP_START_MS + votes * QP_POP_STEP_MS + 700;
}

/** How long a matchup's reveal stays up. */
export function matchupRevealMs(votes: number, jinx: boolean): number {
  return jinx ? 5000 : authorsAt(votes) + 4200;
}

/** Final reveal: votes pop faster; then the authors. */
export const QP_FINAL_POP_MS = 220;
export function finalAuthorsAt(votes: number): number {
  return QP_POP_START_MS + votes * QP_FINAL_POP_MS + 900;
}
export function finalRevealMs(votes: number): number {
  return finalAuthorsAt(votes) + 6000;
}

export { shuffle };
