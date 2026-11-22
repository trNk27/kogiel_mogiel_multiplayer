/**
 * Wesele ("the wedding"): everyone is a guest at a Polish village wedding (2 to 8 players). Pure rules,
 * no DOM.
 *
 * How to win: have the most points at 3:00, when the band packs up.
 *
 * The night runs in songs. Each song starts with a toast to the young couple: drink it for points
 * (+1 shot) or play it safe with kompot. Then come three challenges from the pool below. Every
 * challenge ends the same way:
 *   🏆 the best guest scores WIN_PTS · ✓ everyone who made it scores SAFE_PTS · 🥃 the losers drink a shot.
 * Shots fill your drunk meter, and the drunker you are, the harder your phone is to use (it sways, sees
 * double, lags and hiccups; see phone.tsx). One shot past a full meter and you're under the table: you
 * miss the rest of the song and lose the survivor bonus. Halfway through the night, hot żurek sobers
 * everyone up a little.
 */
import type { WeseleChallenge } from '../../../../shared/protocol';
import { mulberry32, type Rng } from '../rng';

export { mulberry32 };
export type { Rng };

export type ChallengeId = WeseleChallenge;

export const WESELE_SONGS = 5;
export const WESELE_SONGS_SHORT = 2;
/** Challenges per song (after the toast). */
export const PER_SONG = 3;
/** The drunk meter: 0 sober … MAX_DRUNK hammered. One more and you're under the table. */
export const MAX_DRUNK = 5;
/** After passing out you wake up for the next song this drunk. */
export const WAKE_DRUNK = 3;
/** How much the żurek sobers you up. */
export const ZUREK = 2;

// ---- Points ---------------------------------------------------------------------------------------

/** The best guest in a challenge (ties share it). */
export const WIN_PTS = 300;
/** Everyone else who didn't have to drink. */
export const SAFE_PTS = 100;
/** Drinking the toast to the young couple. */
export const TOAST_PTS = 150;
/** Never once under the table. */
export const SURVIVOR_BONUS = 300;

/** The drunk names on the TV, by meter level. */
export const DRUNK_NAMES = ['Sober', 'Tipsy', 'Merry', 'Wobbly', 'Singing', 'Hammered'];

/** Clock time when song `n` (1-based) of `songs` starts, e.g. "18:00". The night ends at 3:00. */
export function clockFor(n: number, songs: number): string {
  const start = 18 * 60;
  const end = 27 * 60;
  const t = n > songs ? end : start + Math.round(((n - 1) * (end - start)) / songs / 30) * 30;
  const h = Math.floor(t / 60) % 24;
  const m = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** What one more shot does: the new drunk level, or passing out. */
export function drink(level: number): { level: number; out: boolean } {
  if (level >= MAX_DRUNK) return { level: MAX_DRUNK, out: true };
  return { level: level + 1, out: false };
}

/** The song at the start of which the żurek is served (halfway through the night), or 0 for none. */
export function zurekSong(songs: number): number {
  return songs > 1 ? Math.floor(songs / 2) + 1 : 0;
}

/** Disco polo hits the band plays, one per song. All made up. */
export const SONG_TITLES = [
  'Pierogi w Rytmie Disco',
  'Wujek Tańczy Dziś',
  'Gorzka Wódeczka',
  'Oczy Babci',
  'Hej, Sokoły Pierogowe',
  'Kompot o Północy',
  'Kiełbasa i Miłość',
  'Remiza Nocą',
];

// ---- The challenges ---------------------------------------------------------------------------------

export interface ChallengeInfo {
  id: ChallengeId;
  emoji: string;
  /** Polish name, then what it is in English. */
  name: string;
  en: string;
  /** What to do, in one short line. */
  how: string;
  /** Who wins. */
  win: string;
  /** Who drinks. */
  lose: string;
}

export const CHALLENGES: Record<ChallengeId, ChallengeInfo> = {
  twirl: {
    id: 'twirl',
    emoji: '🌀',
    name: 'Taniec z Wujkiem',
    en: 'Twirl with Wujek',
    how: 'Draw circles with your finger to twirl',
    win: 'Most twirls',
    lose: 'Too few twirls',
  },
  pair: {
    id: 'pair',
    emoji: '🤝',
    name: 'Oczepiny',
    en: 'The pair game',
    how: 'Hold the button, let go with your partner on NOW!',
    win: 'Closest pair',
    lose: 'Out of sync: both',
  },
  gorzko: {
    id: 'gorzko',
    emoji: '💋',
    name: 'Gorzko! Gorzko!',
    en: 'The kiss chant',
    how: 'Tap as fast as you can',
    win: 'Fastest',
    lose: 'Slowest',
  },
  pour: {
    id: 'pour',
    emoji: '🍾',
    name: 'Nalewanie',
    en: 'Pour the vodka',
    how: 'Hold to pour, let go at the line',
    win: 'Closest to the line',
    lose: 'Spill or furthest off',
  },
  kaczuchy: {
    id: 'kaczuchy',
    emoji: '🐤',
    name: 'Kaczuchy',
    en: 'The duck dance',
    how: 'Watch the TV, then repeat the moves',
    win: 'Fastest, no slips',
    lose: 'Any wrong move',
  },
  train: {
    id: 'train',
    emoji: '🚂',
    name: 'Pociąg',
    en: 'The conga train',
    how: 'Tap on the beat of the music as the dots hit the ring',
    win: 'Best rhythm',
    lose: 'Worst rhythm',
  },
};

export const CHALLENGE_IDS = Object.keys(CHALLENGES) as ChallengeId[];

function shuffle<T>(list: T[], rng: Rng): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The challenges for the night: PER_SONG per song. Every challenge comes up before any comes up again,
 * no challenge twice in one song, and never the same one twice in a row.
 */
export function planNight(songs: number, rng: Rng): ChallengeId[][] {
  const flat: ChallengeId[] = [];
  let bag: ChallengeId[] = [];
  while (flat.length < songs * PER_SONG) {
    if (!bag.length) bag = shuffle(CHALLENGE_IDS, rng);
    const songStart = flat.length - (flat.length % PER_SONG);
    const inSong = flat.slice(songStart);
    const prev = flat[flat.length - 1];
    let k = bag.findIndex((c) => c !== prev && !inSong.includes(c));
    if (k < 0) k = 0;
    flat.push(bag.splice(k, 1)[0]);
  }
  return Array.from({ length: songs }, (_, s) => flat.slice(s * PER_SONG, (s + 1) * PER_SONG));
}

// ---- Grading ----------------------------------------------------------------------------------------

export type Verdict = 'win' | 'safe' | 'drink';

/**
 * Who wins, who's safe and who drinks, from each guest's result in a challenge.
 * - `null` (never answered) or a result `fail` rejects: drink.
 * - `worstDrinks`: of everyone else, the worst result drinks too (unless they all tie, or there's only one).
 * - The best of those who don't drink wins (ties share it); the rest are safe.
 */
export function grade(
  results: Record<string, number | null>,
  opts: { higherBetter: boolean; worstDrinks: boolean; fail?: (v: number) => boolean },
): Record<string, Verdict> {
  const out: Record<string, Verdict> = {};
  const ok: string[] = [];
  for (const [id, v] of Object.entries(results)) {
    if (v === null || !Number.isFinite(v) || opts.fail?.(v)) out[id] = 'drink';
    else ok.push(id);
  }
  const val = (id: string) => (opts.higherBetter ? (results[id] as number) : -(results[id] as number));
  let rest = ok;
  if (opts.worstDrinks && ok.length > 1) {
    const min = Math.min(...ok.map(val));
    const max = Math.max(...ok.map(val));
    if (min !== max) {
      for (const id of ok) if (val(id) === min) out[id] = 'drink';
      rest = ok.filter((id) => val(id) !== min);
    }
  }
  if (rest.length) {
    const best = Math.max(...rest.map(val));
    for (const id of rest) out[id] = val(id) === best ? 'win' : 'safe';
  }
  return out;
}

export function pointsFor(v: Verdict): number {
  return v === 'win' ? WIN_PTS : v === 'safe' ? SAFE_PTS : 0;
}

// ---- Twirl with Wujek ---------------------------------------------------------------------------------

/** How long you twirl, ms. */
export const TWIRL_MS = 8000;
/** Nobody spins faster than this in 8 seconds. */
export const TWIRL_MAX = 40;

/** Twirls you need not to drink: more as the night goes on. */
export function twirlsNeeded(song: number, songs: number): number {
  const t = songs > 1 ? (song - 1) / (songs - 1) : 0.5;
  return 5 + Math.round(3 * t);
}

/** You're dizzy: each full circle of your finger counts for less the drunker you are. */
export function dizzy(drunk: number): number {
  return Math.max(0.5, 1 - 0.07 * drunk);
}

export function gradeTwirl(twirls: Record<string, number | null>, need: number) {
  return grade(twirls, { higherBetter: true, worstDrinks: false, fail: (n) => n < need });
}

// ---- Oczepiny pair game ----------------------------------------------------------------------------

export interface PairTask {
  id: string;
  /** "Clink your glasses", shown on the TV and the phones. */
  title: string;
  /** The button's emoji. */
  button: string;
  /** What appears when it works. */
  done: string;
}

export const PAIR_TASKS: readonly PairTask[] = [
  { id: 'toast', title: 'Clink your glasses together!', button: '🥂', done: 'Na zdrowie!' },
  { id: 'shake', title: 'Shake hands like two old uncles!', button: '🤝', done: 'Deal!' },
  { id: 'five', title: 'High five!', button: '🙌', done: 'Up top!' },
  { id: 'kiss', title: 'Air kiss, three times, Polish style!', button: '😘', done: 'Mwah mwah mwah!' },
  { id: 'stomp', title: 'Stomp the floor together!', button: '🦶', done: 'The floor is shaking!' },
];

/** You must let go within this long of "NOW!". */
export const PAIR_LATE_MS = 900;

/** How close together the two of you must let go: tighter the drunker you both are. */
export function pairWindowMs(drunkA: number, drunkB: number): number {
  return Math.max(160, 420 - 22 * (drunkA + drunkB));
}

/** Did the pair do it? `a` and `b` are when each let go, ms relative to "NOW!" (null: never let go). */
export function pairOk(a: number | null, b: number | null, window: number): boolean {
  if (a === null || b === null) return false;
  if (a < -window || b < -window) return false;
  if (a > PAIR_LATE_MS || b > PAIR_LATE_MS) return false;
  return Math.abs(a - b) <= window;
}

/**
 * Pair the guests up (shuffled, so you get a new partner each time). With an odd number, the last
 * one is paired with Wujek Zbyszek (`null`).
 */
export function makePairs(ids: string[], rng: Rng, mix: boolean): [string, string | null][] {
  const list = mix ? shuffle(ids, rng) : ids.slice();
  const out: [string, string | null][] = [];
  for (let i = 0; i < list.length; i += 2) out.push([list[i], list[i + 1] ?? null]);
  return out;
}

/** When Wujek lets go: he's had a few, so sometimes he's way off. */
export function wujekRelease(rng: Rng): number {
  return rng() < 0.75 ? Math.round((rng() - 0.5) * 240) : Math.round((rng() - 0.3) * 900);
}

// ---- Gorzko! ------------------------------------------------------------------------------------------

export const GORZKO_MS = 5000;
/** Taps faster than this are impossible on a phone. */
export const GORZKO_MAX = 80;

export function gradeGorzko(taps: Record<string, number | null>) {
  return grade(taps, { higherBetter: true, worstDrinks: true, fail: (n) => n < 1 });
}

// ---- Nalewanie (pour the vodka) --------------------------------------------------------------------

/** How long you have to pour, ms. */
export const POUR_MS = 7000;
/** How fast the glass fills when sober, glass per second. */
export const POUR_RATE = 0.26;
/** Past the line by more than this and it's spilled. */
export const SPILL = 0.025;

/** Where the line is drawn on the glass this time (0 empty … 1 brim). */
export function pourLine(rng: Rng): number {
  return Math.round((0.55 + rng() * 0.33) * 100) / 100;
}

/**
 * How fast the vodka comes out at time `t` seconds into a pour: steady when sober; the drunker you are,
 * the more your hand shakes and the flow surges and stalls.
 */
export function pourRate(t: number, drunk: number): number {
  const wobble = drunk * 0.11 * (Math.sin(t * 5.3) + 0.6 * Math.sin(t * 11.7 + 1));
  return Math.max(0.05, POUR_RATE * (1 + wobble));
}

export function spilled(level: number, line: number): boolean {
  return level > line + SPILL;
}

/** Results are where each guest stopped (0–1.2), null for not pouring at all. */
export function gradePour(levels: Record<string, number | null>, line: number) {
  const off: Record<string, number | null> = {};
  for (const [id, l] of Object.entries(levels)) off[id] = l === null || l <= 0 ? null : spilled(l, line) ? Infinity : Math.round(Math.abs(line - l) * 1000);
  return grade(off, { higherBetter: false, worstDrinks: true });
}

// ---- Kaczuchy (the duck dance) ----------------------------------------------------------------------

export interface Move {
  emoji: string;
  name: string;
}

/** The four moves of the duck dance. */
export const MOVES: readonly Move[] = [
  { emoji: '🐤', name: 'Beak' },
  { emoji: '🪽', name: 'Wings' },
  { emoji: '🍑', name: 'Wiggle' },
  { emoji: '👏', name: 'Clap' },
];

/** How long each move is shown on the TV, ms. */
export const MOVE_SHOW_MS = 1000;
/** How long you have to repeat the moves, ms. */
export const MOVES_MS = 12000;

/** How many moves to remember: more later in the night. */
export function movesNeeded(song: number, songs: number): number {
  const t = songs > 1 ? (song - 1) / (songs - 1) : 0.5;
  return 4 + Math.round(2 * t);
}

/** A sequence of moves, never the same one three times running. */
export function makeMoves(n: number, rng: Rng): number[] {
  const out: number[] = [];
  while (out.length < n) {
    const m = Math.floor(rng() * MOVES.length);
    if (out.length >= 2 && out[out.length - 1] === m && out[out.length - 2] === m) continue;
    out.push(m);
  }
  return out;
}

export function movesRight(seq: number[], got: number[] | null | undefined): boolean {
  return !!got && got.length === seq.length && got.every((m, i) => m === seq[i]);
}

/** Results are ms taken, null for a slip or not finishing. */
export function gradeMoves(ms: Record<string, number | null>) {
  return grade(ms, { higherBetter: false, worstDrinks: false });
}

// ---- Pociąg (the conga train, a rhythm game) ---------------------------------------------------------

export const TRAIN_BEATS = 8;
/** Time between beats, ms, when the band isn't playing (normally the train follows the music's beat). */
export function trainBeatMs(song: number, songs: number): number {
  const t = songs > 1 ? (song - 1) / (songs - 1) : 0.5;
  return Math.round(620 - 120 * t);
}
/** A beat you didn't tap counts as this far off, ms. */
export const TRAIN_MISS_MS = 300;

/**
 * How far off the beat a set of taps was, on average (ms). Each beat takes the nearest unused tap
 * within reach; taps that match no beat count as misses too, so hammering the screen doesn't help.
 * `taps` and `beats` are in the same clock.
 */
export function trainError(taps: number[], beats: number[]): { err: number; hits: number } {
  const used = new Set<number>();
  let total = 0;
  let hits = 0;
  for (const b of beats) {
    let best = -1;
    for (let i = 0; i < taps.length; i++) {
      if (used.has(i) || Math.abs(taps[i] - b) > TRAIN_MISS_MS) continue;
      if (best < 0 || Math.abs(taps[i] - b) < Math.abs(taps[best] - b)) best = i;
    }
    if (best >= 0) {
      used.add(best);
      total += Math.abs(taps[best] - b);
      hits++;
    } else total += TRAIN_MISS_MS;
  }
  const extra = taps.length - used.size;
  total += extra * TRAIN_MISS_MS * 0.5;
  return { err: Math.round(total / Math.max(1, beats.length)), hits };
}

/** Results are average error in ms (null: didn't play); fewer than half the beats hit is a fail. */
export function gradeTrain(errs: Record<string, number | null>) {
  return grade(errs, { higherBetter: false, worstDrinks: true, fail: (e) => e >= TRAIN_MISS_MS * 0.6 });
}

// ---- The toast -------------------------------------------------------------------------------------------

export type ToastChoice = 'drink' | 'kompot';

export function howTo(short: boolean): string[] {
  return [
    `🏆 Most points at 3:00 wins · ${short ? '2 songs' : '5 songs'}`,
    '🥃 Lose a challenge, drink a shot: your phone gets wobblier',
    '💤 A shot on a full meter and you pass out',
  ];
}
