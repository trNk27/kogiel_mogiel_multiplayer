import { MAX_TITLE_LENGTH } from '../../../../shared/protocol';
import type { Rng } from '../rng';
import { pickQuestions, shuffle } from '../quiz/logic';

export interface BzPrompt {
  id: string;
  prompt: string;
}

export const BZ_DRAW_MS = 80_000;
export const BZ_LIE_MS = 45_000;
export const BZ_GUESS_MS = 20_000;
/** Points for finding the real title. */
export const BZ_TRUTH_POINTS = 1000;
/** Points for the artist, per player who found the real title. */
export const BZ_ARTIST_POINTS = 1000;
/** Points per player who fell for your lie. */
export const BZ_LIE_POINTS = 500;
/** Every drawing gets at least this many titles to choose from (the game adds decoys). */
export const BZ_MIN_OPTIONS = 3;

/**
 * Two rounds for small groups, one for big ones (every player's drawing is shown each round). The second round pays double.
 * A tournament's short game is always one round.
 */
export function roundsFor(players: number, short = false): number {
  return !short && players <= 4 ? 2 : 1;
}

/** Give every player their own prompt for the round. Mutates `used`. */
export function assignPrompts(pool: readonly BzPrompt[], used: Set<string>, ids: readonly string[], rng: Rng = Math.random): Record<string, string> {
  const picked = pickQuestions(pool, used, ids.length, rng);
  const out: Record<string, string> = {};
  ids.forEach((id, i) => (out[id] = picked[i].prompt));
  return out;
}

/** Clean up a typed title. Returns '' if nothing usable is left. */
export function sanitizeTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
    .trim();
}

/**
 * How a title compares to others: lower case, no accents, no apostrophes or other punctuation and
 * no "a", "an" or "the". "The Haunted toaster!" and "a haunted toaster" are the same title.
 */
export function titleKey(s: string): string {
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

export interface BzOption {
  text: string;
  truth: boolean;
  /** Who wrote this lie (several players can write the same one). Empty for the truth and decoys. */
  authors: string[];
}

/**
 * The titles to choose from: the truth, every player's lie (identical lies merged) and, if there
 * are fewer than BZ_MIN_OPTIONS, decoys. Lies that match the truth are dropped (the host turns
 * those down already). Shuffled.
 */
export function buildOptions(truth: string, lies: Record<string, string>, decoys: readonly string[], rng: Rng = Math.random): BzOption[] {
  const options: BzOption[] = [{ text: truth, truth: true, authors: [] }];
  const byKey = new Map<string, BzOption>([[titleKey(truth), options[0]]]);
  for (const [author, text] of Object.entries(lies)) {
    const key = titleKey(text);
    if (!key) continue;
    const same = byKey.get(key);
    if (same) {
      if (!same.truth) same.authors.push(author);
      continue;
    }
    const o = { text, truth: false, authors: [author] };
    byKey.set(key, o);
    options.push(o);
  }
  for (const text of decoys) {
    if (options.length >= BZ_MIN_OPTIONS) break;
    const key = titleKey(text);
    if (!key || byKey.has(key)) continue;
    const o = { text, truth: false, authors: [] };
    byKey.set(key, o);
    options.push(o);
  }
  return shuffle(options, rng);
}

export interface BzScore {
  /** Points per player for this drawing. */
  points: Record<string, number>;
  /** How many found the real title. */
  found: number;
  /** How many players picked each option. */
  pickers: string[][];
}

/**
 * Score one drawing. `picks` maps guesser → option index; the artist's pick and picks of your
 * own lie are ignored. `mult` is the round's multiplier.
 */
export function scoreDrawing(options: readonly BzOption[], picks: Record<string, number>, artist: string, mult = 1): BzScore {
  const points: Record<string, number> = {};
  const add = (id: string, pts: number) => (points[id] = (points[id] ?? 0) + pts);
  const pickers: string[][] = options.map(() => []);
  let found = 0;
  for (const [guesser, i] of Object.entries(picks)) {
    const o = options[i];
    if (guesser === artist || !o || o.authors.includes(guesser)) continue;
    pickers[i].push(guesser);
    if (o.truth) {
      found++;
      add(guesser, BZ_TRUTH_POINTS * mult);
      add(artist, BZ_ARTIST_POINTS * mult);
    } else {
      for (const a of o.authors) add(a, BZ_LIE_POINTS * mult);
    }
  }
  return { points, found, pickers };
}

/**
 * The order the TV reveals the titles in: lies that fooled somebody, least popular first, and the
 * truth last.
 */
export function revealOrder(options: readonly BzOption[], pickers: readonly string[][]): number[] {
  const lies = options
    .map((_, i) => i)
    .filter((i) => !options[i].truth && pickers[i].length > 0)
    .sort((a, b) => pickers[a].length - pickers[b].length);
  return [...lies, options.findIndex((o) => o.truth)];
}

export { shuffle };
