/**
 * Wesele ("the wedding"): everyone is a guest at a Polish village wedding (2 to 8 players). Pure rules,
 * no DOM. The shots are in the game only: every shot raises your drunk meter, and the drunker you are,
 * the harder your phone is to use (it sways, sees double, lags and hiccups; see phone.tsx).
 *
 * The night runs in songs, from 18:00 to 3:00. Each song:
 *   1. Kolejka!  a round of shots: swipe the glass up to drink.
 *   2. Twirl     dance with a drunk uncle: spin your finger in circles to twirl. Too few twirls and he makes
 *                you drink, then dance again.
 *   3. Oczepiny  a pair game: you and your partner must let go of the button at the same moment on "NOW!"
 *                (toast, handshake, high five…). Miss and you both drink, then try again.
 *   4. Gorzko!   tap as fast as you can while the room chants; the slowest drinks.
 * Drink past the top of the meter and you pass out under the table for the rest of the song.
 */
import { mulberry32, type Rng } from '../rng';

export { mulberry32 };
export type { Rng };

export const WESELE_SONGS = 5;
export const WESELE_SONGS_SHORT = 2;
/** The drunk meter: 0 sober … MAX_DRUNK wobbly. One more and you're under the table. */
export const MAX_DRUNK = 5;
/** After passing out you wake up for the next song a bit less drunk. */
export const WAKE_DRUNK = 3;

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

// ---- Twirl dance ------------------------------------------------------------------------------

/** How long you twirl with Wujek, ms. */
export const DANCE_MS = 8000;
/** Nobody spins faster than this in 8 seconds. */
export const DANCE_MAX = 40;

/** Twirls you need: more as the night goes on. */
export function twirlsNeeded(song: number, songs: number): number {
  const t = songs > 1 ? (song - 1) / (songs - 1) : 0.5;
  return 6 + Math.round(3 * t);
}

/** You're dizzy: each full circle of your finger counts for less the drunker you are. */
export function dizzy(drunk: number): number {
  return Math.max(0.5, 1 - 0.07 * drunk);
}

export function dancePassed(twirls: number, need: number): boolean {
  return twirls >= need;
}

// ---- Oczepiny pair game ------------------------------------------------------------------------

export interface PairTask {
  id: string;
  /** "Clink your glasses", shown on the TV and the phones. */
  title: string;
  /** The button label, e.g. "🥂 HOLD". */
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

/** Most tries per pair before the wodzirej gives up on them. */
export const PAIR_TRIES = 3;
/** You must let go within this long of "NOW!". */
export const PAIR_LATE_MS = 900;

/** How close together the two of you must let go: tighter the drunker you both are. */
export function pairWindowMs(drunkA: number, drunkB: number): number {
  return Math.max(160, 420 - 22 * (drunkA + drunkB));
}

/**
 * Did the pair do it? `a` and `b` are when each let go, ms relative to "NOW!" (null: never let go).
 */
export function pairOk(a: number | null, b: number | null, window: number): boolean {
  if (a === null || b === null) return false;
  if (a < -window || b < -window) return false;
  if (a > PAIR_LATE_MS || b > PAIR_LATE_MS) return false;
  return Math.abs(a - b) <= window;
}

export const PAIR_POINTS = [300, 200, 100];

/**
 * Pair the guests up (shuffled, so you get a new partner each song). With an odd number, the last
 * one is paired with Wujek Zbyszek (`null`).
 */
export function makePairs(ids: string[], rng: Rng, shuffle: boolean): [string, string | null][] {
  const list = ids.slice();
  if (shuffle) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  const out: [string, string | null][] = [];
  for (let i = 0; i < list.length; i += 2) out.push([list[i], list[i + 1] ?? null]);
  return out;
}

/** When Wujek lets go: he's had a few, so sometimes he's way off. */
export function wujekRelease(rng: Rng): number {
  return rng() < 0.75 ? Math.round((rng() - 0.5) * 240) : Math.round((rng() - 0.3) * 900);
}

// ---- Gorzko! ------------------------------------------------------------------------------------

export const GORZKO_MS = 5000;
/** Taps faster than this are impossible on a phone. */
export const GORZKO_MAX = 80;

/** Points for each place in the tap race (ties share). The slowest drinks. */
export function gorzkoPoints(counts: Record<string, number>): { pts: Record<string, number>; slowest: string[] } {
  const ids = Object.keys(counts);
  const pts: Record<string, number> = {};
  for (const id of ids) {
    const better = ids.filter((o) => counts[o] > counts[id]).length;
    pts[id] = Math.max(0, 200 - better * 40) + counts[id] * 3;
  }
  const min = Math.min(...ids.map((id) => counts[id]));
  const slowest = ids.length > 1 ? ids.filter((id) => counts[id] === min) : [];
  return { pts, slowest: slowest.length === ids.length ? [] : slowest };
}

// ---- Points ---------------------------------------------------------------------------------------

export const SHOT_POINTS = 50;
export const TWIRL_POINTS = 20;
export const DANCE_PASS_BONUS = 100;
export const SURVIVOR_BONUS = 300;

/** The drunk names on the TV. */
export const DRUNK_NAMES = ['Sober', 'Tipsy', 'Happy', 'Wobbly', 'Singing', 'Hammered'];

export function howTo(short: boolean): string[] {
  return [
    'Shots, twirls with drunk uncles, oczepiny pair games and Gorzko!',
    'Every shot makes your phone harder to use. Fail a task, drink, try again',
    `Survive till 3:00 · ${short ? '2 songs' : '5 songs'} · let go together on NOW! with your partner`,
  ];
}
