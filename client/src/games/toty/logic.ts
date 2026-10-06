import { DOODLE_COLORS, DOODLE_SPACE, DOODLE_WIDTHS, MAX_DOODLE_POINTS, MAX_PHOTO_CHARS, type Stroke } from '../../../../shared/protocol';
import type { Rng } from '../rng';
import { pickQuestions, shuffle } from '../quiz/logic';

export interface TotyQuestion {
  id: string;
  question: string;
  /** Doodle prompt for the player the room picked; `{name}` is replaced by their name. */
  draw?: string;
}

export const TY_SELFIE_MS = 75_000;
export const TY_VOTE_MS = 20_000;
export const TY_DRAW_MS = 70_000;
export const TY_PICK_MS = 25_000;
/** Points for voting with the room (the final question pays double). */
export const TY_VOTE_POINTS = 100;
/** Points per vote a doodle receives. */
export const TY_DOODLE_POINTS = 100;
/** Seven questions; a doodle round follows questions 3 and 6, and question 7 pays double. */
export const TY_QUESTIONS = 7;
export const TY_DOODLE_AFTER = [2, 5] as const;
/** How a game is laid out: how many questions, and after which ones (0-based) a doodle round comes. */
export interface TyLayout {
  questions: number;
  doodleAfter: readonly number[];
  selfieMs: number;
}
export const TY_FULL: TyLayout = { questions: TY_QUESTIONS, doodleAfter: TY_DOODLE_AFTER, selfieMs: TY_SELFIE_MS };
/** Tournament version: four questions with one doodle round after question 2, and less time for selfies. */
export const TY_SHORT: TyLayout = { questions: 4, doodleAfter: [1], selfieMs: 45_000 };
export const TY_LETTERS = 'ABCDEFGH';

/**
 * Pick the questions for one game. The ones followed by a doodle round must have a
 * drawing prompt; the rest come from the whole pool. Mutates `used`.
 */
export function pickPlan(pool: readonly TotyQuestion[], used: Set<string>, rng: Rng = Math.random, layout: TyLayout = TY_FULL): TotyQuestion[] {
  const drawable = pickQuestions(
    pool.filter((q) => q.draw),
    used,
    layout.doodleAfter.length,
    rng,
  );
  const taken = new Set(drawable.map((q) => q.id));
  const rest = pickQuestions(
    pool.filter((q) => !taken.has(q.id)),
    used,
    layout.questions - drawable.length,
    rng,
  );
  for (const id of taken) used.add(id);
  const plan: TotyQuestion[] = [];
  let d = 0;
  let r = 0;
  for (let i = 0; i < layout.questions; i++) {
    plan.push(layout.doodleAfter.includes(i) ? drawable[d++] : rest[r++]);
  }
  return plan;
}

export interface Tally {
  /** Votes received per player id. */
  counts: Record<string, number>;
  /** The player(s) with the most votes, if at least two people agreed. */
  winners: string[];
}

/**
 * Count the votes (voter → voted-for). Votes for players who are no longer in the game are
 * ignored. The room only "picks" someone when at least two votes agree.
 */
export function tally(votes: Record<string, string>, players: readonly string[]): Tally {
  const counts: Record<string, number> = {};
  for (const id of players) counts[id] = 0;
  for (const target of Object.values(votes)) if (target in counts) counts[target]++;
  const max = Math.max(0, ...Object.values(counts));
  const winners = max >= 2 ? players.filter((id) => counts[id] === max) : [];
  return { counts, winners };
}

/** Everyone who voted for one of the winners scores. */
export function scoreVotes(votes: Record<string, string>, t: Tally, double = false): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [voter, target] of Object.entries(votes)) {
    out[voter] = t.winners.includes(target) ? TY_VOTE_POINTS * (double ? 2 : 1) : 0;
  }
  return out;
}

/** Votes per gallery position, ignoring picks of one's own doodle or out-of-range picks. */
export function tallyPicks(picks: Record<string, number>, gallery: readonly string[]): number[] {
  const counts = gallery.map(() => 0);
  for (const [voter, i] of Object.entries(picks)) {
    if (Number.isInteger(i) && i >= 0 && i < gallery.length && gallery[i] !== voter) counts[i]++;
  }
  return counts;
}

/** Pick one element at random. */
export function pickOne<T>(items: readonly T[], rng: Rng = Math.random): T | undefined {
  return items.length ? items[Math.floor(rng() * items.length)] : undefined;
}

export { shuffle };

/** Check a doodle from a phone and normalise it. Returns null if it is malformed. */
export function sanitizeStrokes(raw: unknown): Stroke[] | null {
  if (!Array.isArray(raw) || raw.length > 600) return null;
  const out: Stroke[] = [];
  let points = 0;
  for (const s of raw) {
    if (!Array.isArray(s) || s.length < 4 || s.length % 2 !== 0) return null;
    const [c, w] = s;
    if (!Number.isInteger(c) || c < 0 || c >= DOODLE_COLORS.length) return null;
    if (!Number.isInteger(w) || w < 0 || w >= DOODLE_WIDTHS.length) return null;
    const stroke: Stroke = [c, w];
    for (let i = 2; i < s.length; i++) {
      const v = s[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      stroke.push(Math.max(0, Math.min(DOODLE_SPACE, Math.round(v))));
    }
    points += (stroke.length - 2) / 2;
    if (points > MAX_DOODLE_POINTS) return null;
    out.push(stroke);
  }
  return out;
}

/** SVG path for a stroke with at least two points. */
export function strokePath(s: Stroke): string {
  let d = `M${s[2]} ${s[3]}`;
  for (let i = 4; i < s.length; i += 2) d += `L${s[i]} ${s[i + 1]}`;
  return d;
}

const PHOTO_RE = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/]+=*$/;

export function isPhotoData(s: unknown): s is string {
  return typeof s === 'string' && s.length <= MAX_PHOTO_CHARS && PHOTO_RE.test(s);
}
