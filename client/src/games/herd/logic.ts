/**
 * Zgodni ("in agreement"): our take on Herd Mentality. Everyone types an answer to an open question,
 * and the answers are herded together. The single biggest herd scores a pierogi each; the one lone
 * odd one out gets the Pink Cow (Różowa Krowa), which costs 2 points at the end.
 *
 * Pure: no DOM, no three.js.
 */
import type { Rng } from '../rng';
import { pickQuestions } from '../quiz/logic';

export interface HerdQuestion {
  id: string;
  q: string;
}

export const HERD_QUESTIONS = 10;
export const HERD_QUESTIONS_SHORT = 6;
export const ANSWER_MS = 30_000;
export const MAX_ANSWER = 30;
/** What the Pink Cow costs whoever holds it when the game ends. */
export const COW_PENALTY = 2;

export function questionsFor(short: boolean): number {
  return short ? HERD_QUESTIONS_SHORT : HERD_QUESTIONS;
}

export function howTo(short: boolean): string[] {
  return [
    'Type what you think everybody else will',
    'The biggest herd scores – a tie scores nobody',
    `${questionsFor(short)} questions · the lone odd one gets the Pink Cow (−2)`,
  ];
}

/** Pick this game's questions (no repeats in a session while the pool lasts). Mutates `used`. */
export function pickHerdQuestions(pool: readonly HerdQuestion[], used: Set<string>, n: number, rng: Rng = Math.random): HerdQuestion[] {
  return pickQuestions(pool, used, n, rng);
}

/** Clean up a typed answer for display: no control characters or angle brackets, one space, ≤ 30 chars. */
export function sanitizeAnswer(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\t\n\r]/g, ' ')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ANSWER)
    .trim();
}

// ---- normalisation -------------------------------------------------------------------------------

/** Letters that don't decompose into a base letter plus an accent. */
const FOLD: Record<string, string> = { ł: 'l', ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };
const ARTICLES = new Set(['a', 'an', 'the']);
const EN_NUMBERS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];
/** Polish too (after the accents are gone): "siedem" = "7". */
const PL_NUMBERS = ['zero', 'jeden', 'dwa', 'trzy', 'cztery', 'piec', 'szesc', 'siedem', 'osiem', 'dziewiec', 'dziesiec'];
const NUMBERS = new Map<string, string>([...PL_NUMBERS.map((w, i) => [w, String(i)] as const), ...EN_NUMBERS.map((w, i) => [w, String(i)] as const)]);

/**
 * Simple plural folding, the same for singular and plural: a trailing "s" (not "ss"), then a
 * trailing "e", then a trailing "i" becomes "y". So cats → cat, tomatoes = tomato, boxes = box,
 * cheeses = cheese, berries = berry, cookies = cookie, glasses = glass. Short words are left alone.
 */
function fold(w: string): string {
  if (/^\d+$/.test(w)) return w.replace(/^0+(?=\d)/, '');
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('i')) w = w.slice(0, -1) + 'y';
  return w;
}

/**
 * The key two answers are compared by: lower case, no accents (ą → a, ł → l, ó → o…), no
 * punctuation or spaces, no leading "a", "an" or "the", number words 0–20 as digits and plurals
 * folded. "The Seven Dwarfs!" → "7dwarf". '' means there's no answer.
 */
export function normalizeAnswer(raw: string): string {
  let s = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[łßæœøđðþı]/g, (c) => FOLD[c] ?? c);
  s = s.replace(/['’‘`´]/g, '').replace(/&/g, ' and ');
  const words = s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  while (words.length > 1 && ARTICLES.has(words[0])) words.shift();
  return words.map((w) => NUMBERS.get(w) ?? fold(w)).join('');
}

/** Edit distance, giving up (returning max + 1) once it's sure to be more than `max`. */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * How many typos two normalised answers may differ by: 1 when the shorter one has 5 or more
 * letters, 2 from 9 letters, none for shorter words or anything with a digit in it (7 ≠ 8).
 */
export function typoAllowance(a: string, b: string): number {
  if (/\d/.test(a) || /\d/.test(b)) return 0;
  const n = Math.min(a.length, b.length);
  return n >= 9 ? 2 : n >= 5 ? 1 : 0;
}

/** Do two normalised answers count as the same? Blank never matches anything. */
export function sameKey(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const k = typoAllowance(a, b);
  return k > 0 && levenshtein(a, b, k) <= k;
}

/** Do two typed answers count as the same? */
export function sameAnswer(a: string, b: string): boolean {
  return sameKey(normalizeAnswer(a), normalizeAnswer(b));
}

// ---- herding ---------------------------------------------------------------------------------------

export interface HerdEntry {
  id: string;
  /** What they typed ('' for no answer). */
  text: string;
}

export interface Herd {
  /** Player ids, in entry order. */
  members: string[];
  /** The answer to show on the herd's sign: the most typed spelling (the earliest on a tie). */
  label: string;
  /** Its normalised key ('' for a blank answer). */
  key: string;
  /** A player with no answer: always a herd of one. */
  blank: boolean;
}

/**
 * Herd the answers: union-find over every pair that matches (same key, or within the typo
 * allowance), so matching is transitive – if A matches B and B matches C, all three are one herd
 * even when A and C don't match directly. Herds are listed by their earliest member; the grouping
 * itself doesn't depend on the order of the entries. Blank answers are herds of one each.
 */
export function groupAnswers(entries: readonly HerdEntry[]): Herd[] {
  const keys = entries.map((e) => normalizeAnswer(e.text));
  const parent = entries.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      if (!sameKey(keys[i], keys[j])) continue;
      const a = find(i);
      const b = find(j);
      // The smaller index is always the root, so a herd's root is its earliest member.
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  const byRoot = new Map<number, number[]>();
  entries.forEach((_, i) => {
    const r = keys[i] ? find(i) : i;
    const list = byRoot.get(r);
    if (list) list.push(i);
    else byRoot.set(r, [i]);
  });
  return [...byRoot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, idx]) => {
      const blank = !keys[idx[0]];
      const count = new Map<string, number>();
      for (const i of idx) count.set(keys[i], (count.get(keys[i]) ?? 0) + 1);
      let best = idx[0];
      for (const i of idx) if ((count.get(keys[i]) ?? 0) > (count.get(keys[best]) ?? 0)) best = i;
      return { members: idx.map((i) => entries[i].id), label: blank ? '' : entries[best].text, key: keys[best], blank };
    });
}

export type Verdict = 'herd' | 'tie' | 'apart';

export interface HerdOutcome {
  herds: Herd[];
  /** The herd that scores (index into `herds`), or -1. */
  winner: number;
  /** Who scores a pierogi. */
  scorers: string[];
  /** herd: one herd was biggest; tie: the biggest herds were the same size; apart: nobody agreed with anybody. */
  verdict: Verdict;
  /** The one player alone in a herd of one (everyone else in herds of 2+): they get the Pink Cow. */
  cow: string | null;
}

/**
 * Score one question. The single biggest herd (2 or more, strictly bigger than every other) scores
 * a point each; a tie for biggest scores nobody. Blank answers never score. If exactly one player is
 * alone – everyone else in herds of 2 or more, and at least two others – they get the Pink Cow. A
 * blank counts as alone, so a lone blank among herds gets the cow, but two blanks (or a blank and a
 * lone answer) leave it where it is.
 */
export function scoreQuestion(entries: readonly HerdEntry[]): HerdOutcome {
  const herds = groupAnswers(entries);
  const sizes = herds.map((h) => (h.blank ? 0 : h.members.length));
  const top = Math.max(0, ...sizes);
  const atTop = sizes.filter((s) => s === top).length;
  const winner = top >= 2 && atTop === 1 ? sizes.indexOf(top) : -1;
  const singles = herds.filter((h) => h.members.length === 1);
  const cow = singles.length === 1 && entries.length >= 3 ? singles[0].members[0] : null;
  return {
    herds,
    winner,
    scorers: winner >= 0 ? [...herds[winner].members] : [],
    verdict: winner >= 0 ? 'herd' : top >= 2 ? 'tie' : 'apart',
    cow,
  };
}

/**
 * The order the TV forms the herds in: no-answers first, then the smallest herds, the biggest last
 * (ties keep their order).
 */
export function revealOrder(herds: readonly Herd[]): number[] {
  const rank = (h: Herd) => (h.blank ? 0 : h.members.length);
  return herds.map((_, i) => i).sort((a, b) => rank(herds[a]) - rank(herds[b]) || a - b);
}

// ---- the match --------------------------------------------------------------------------------------

export interface Applied {
  gained: string[];
  /** Who had the cow before (null: nobody), and who has it now. */
  cowFrom: string | null;
  cowTo: string | null;
  /** The cow changed hands this question. */
  cowMoved: boolean;
}

/** Scores and the Pink Cow across a whole game. */
export class HerdMatch {
  readonly scores: Record<string, number> = {};
  cow: string | null = null;

  constructor(ids: readonly string[]) {
    for (const id of ids) this.scores[id] = 0;
  }

  apply(o: HerdOutcome): Applied {
    const gained = o.scorers.filter((id) => id in this.scores);
    for (const id of gained) this.scores[id]++;
    const cowFrom = this.cow;
    if (o.cow && o.cow in this.scores) this.cow = o.cow;
    return { gained, cowFrom, cowTo: this.cow, cowMoved: this.cow !== cowFrom };
  }

  /** A player left: their score goes, and so does the cow if they had it. */
  remove(id: string) {
    delete this.scores[id];
    if (this.cow === id) this.cow = null;
  }

  /** What the cow costs this player at the end. */
  penalty(id: string): number {
    return this.cow === id ? Math.min(COW_PENALTY, this.scores[id] ?? 0) : 0;
  }

  /** Final scores: the cow's holder loses 2 (never below 0). */
  final(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, s] of Object.entries(this.scores)) out[id] = s - this.penalty(id);
    return out;
  }
}

// ---- where things stand on the pasture ------------------------------------------------------------------

export interface Spot {
  x: number;
  z: number;
}

/** Where the pierogi graze while they think: spread across the meadow, alternately nearer and further. */
export function homeSpots(n: number): Spot[] {
  const w = Math.min(24, 4 + n * 3);
  return Array.from({ length: n }, (_, i) => ({ x: n === 1 ? 0 : -w / 2 + (w * i) / (n - 1), z: i % 2 ? 0.6 : -2.2 }));
}

/**
 * Where the herds gather, in reveal order: one row for up to 4 herds, two rows (back row first) for
 * more. x runs across the meadow, z towards the camera.
 */
export function herdSpots(n: number): Spot[] {
  const rows = n <= 4 ? [n] : [Math.ceil(n / 2), Math.floor(n / 2)];
  const out: Spot[] = [];
  rows.forEach((count, r) => {
    const z = rows.length === 1 ? -1.2 : r === 0 ? -4.6 : 1.6;
    const w = count <= 2 ? 15 : 25;
    for (let i = 0; i < count; i++) out.push({ x: count === 1 ? 0 : -w / 2 + (w * i) / (count - 1), z });
  });
  return out;
}

/** Offsets for the members of a herd of `n` round its spot: a ring, with one in the middle from 6 up. */
export function clusterOffsets(n: number): Spot[] {
  if (n <= 1) return [{ x: 0, z: 0 }];
  const centre = n >= 6;
  const ring = centre ? n - 1 : n;
  const r = Math.max(0.95, ring * 0.27);
  const out: Spot[] = centre ? [{ x: 0, z: 0 }] : [];
  for (let k = 0; k < ring; k++) {
    // Start at the front so the first members stand where the camera sees them best.
    const a = Math.PI / 2 + (k / ring) * Math.PI * 2;
    out.push({ x: Math.cos(a) * r * 1.25, z: Math.sin(a) * r * 0.8 });
  }
  return out;
}

/** How far a herd's members spread from its spot (for the sign and the glow). */
export function clusterRadius(n: number): number {
  return n <= 1 ? 0.8 : Math.max(0.95, (n >= 6 ? n - 1 : n) * 0.27) * 1.25 + 0.8;
}
