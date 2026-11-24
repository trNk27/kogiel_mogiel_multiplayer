/**
 * Wo ist der Pieróg? Hide-and-seek at the Vienna Christmas market. Pure rules, no DOM.
 *
 * Each round one pierogi hides at a stall (secretly, on their phone) and everyone else hunts for it,
 * walking stall to stall through the crowds. Seekers can sniff for a hot/cold clue that only they see.
 * The hider fights back with tricks: a fake sighting on the TV, sending the watch seller to block a
 * seeker, or sneaking to the next stall. Walk into the Krampus tent and everyone is pulled into the
 * Krampuslauf on the ice: hold to skate, let go when Krampus looks. Built for playing over a video
 * call: everything is taps, and anything timing-critical is measured on the phone.
 */
import { mulberry32, type Rng } from '../rng';

export { mulberry32 };
export type { Rng };

export interface Spot {
  id: string;
  emoji: string;
  name: string;
  col: number;
  row: number;
}

export const COLS = 4;
export const ROWS = 3;

/** The market, a 4×3 grid of stalls. The entrance arch is under the bottom row. */
export const SPOTS: readonly Spot[] = [
  { id: 'wheel', emoji: '🎡', name: 'Riesenrad', col: 0, row: 0 },
  { id: 'tree', emoji: '🎄', name: 'Christbaum', col: 1, row: 0 },
  { id: 'hearts', emoji: '💗', name: 'Herzerlbaum', col: 2, row: 0 },
  { id: 'rink', emoji: '⛸️', name: 'Eislaufplatz', col: 3, row: 0 },
  { id: 'maroni', emoji: '🌰', name: 'Maroni', col: 0, row: 1 },
  { id: 'gluehwein', emoji: '🍷', name: 'Glühwein', col: 1, row: 1 },
  { id: 'lebkuchen', emoji: '🍪', name: 'Lebkuchen', col: 2, row: 1 },
  { id: 'carousel', emoji: '🎠', name: 'Karussell', col: 3, row: 1 },
  { id: 'tent', emoji: '⛺', name: 'Krampus tent', col: 0, row: 2 },
  { id: 'baubles', emoji: '🔮', name: 'Christbaumkugeln', col: 1, row: 2 },
  { id: 'punsch', emoji: '🍹', name: 'Punsch', col: 2, row: 2 },
  { id: 'curling', emoji: '🥌', name: 'Eisstockschießen', col: 3, row: 2 },
];

export const TENT = SPOTS.findIndex((s) => s.id === 'tent');
export const GLUEHWEIN = SPOTS.findIndex((s) => s.id === 'gluehwein');
/** Where seekers come in, through the arch. */
export const ENTRANCES = [SPOTS.findIndex((s) => s.id === 'baubles'), SPOTS.findIndex((s) => s.id === 'punsch')];

export function spotAt(col: number, row: number): number {
  return SPOTS.findIndex((s) => s.col === col && s.row === row);
}

/** Stalls you can walk to from `i` (left, right, up, down). */
export function neighbours(i: number): number[] {
  const s = SPOTS[i];
  const out: number[] = [];
  for (const [dc, dr] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    const j = spotAt(s.col + dc, s.row + dr);
    if (j >= 0) out.push(j);
  }
  return out;
}

export function distance(a: number, b: number): number {
  return Math.abs(SPOTS[a].col - SPOTS[b].col) + Math.abs(SPOTS[a].row - SPOTS[b].row);
}

/** Where the hider may hide: anywhere but the tent and the entrances. */
export function canHide(i: number): boolean {
  return i >= 0 && i < SPOTS.length && i !== TENT && !ENTRANCES.includes(i);
}

/** A key for the path between two stalls, the same both ways. */
export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** How busy each path is this round: 1 (quiet) to 3 (packed). */
export function makeCrowds(rng: Rng): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < SPOTS.length; i++)
    for (const j of neighbours(i)) {
      const k = edgeKey(i, j);
      if (!(k in out)) {
        const r = rng();
        out[k] = r < 0.35 ? 1 : r < 0.75 ? 2 : 3;
      }
    }
  return out;
}

/** How long walking a path takes, ms. A glühwein makes you bolder in a crowd. */
export function walkMs(crowd: number, boosted: boolean): number {
  const base = 900 + crowd * 750;
  return Math.round(boosted ? base * 0.6 : base);
}

export type Clue = 'here' | 'hot' | 'warm' | 'cold';

/** What a sniff tells you. */
export function sniff(at: number, hider: number): Clue {
  const d = distance(at, hider);
  return d === 0 ? 'here' : d === 1 ? 'hot' : d === 2 ? 'warm' : 'cold';
}

export const CLUE_TEXT: Record<Clue, string> = {
  here: 'Right here!',
  hot: '🔥 Hot! Next stall over',
  warm: '♨️ Warm. Two stalls away',
  cold: '❄️ Cold. Far away',
};

// ---- Timing ---------------------------------------------------------------------------------

export const HIDE_MS = 12_000;
export const HUNT_MS = 45_000;
export const SNIFF_COOLDOWN_MS = 5_000;
export const TRICK_COOLDOWN_MS = 8_000;
/** The market tells everyone a true rumour this often. The hider's fakes look the same. */
export const RUMOUR_EVERY_MS = 14_000;
export const RUMOUR_SHOW_MS = 5_000;
/** Taps on "Nein, danke!" to get rid of the watch seller. */
export const SELLER_TAPS = 8;

/** A true rumour: a stall next to (or at) where the hider is. */
export function trueRumour(hider: number, rng: Rng): number {
  const near = [hider, ...neighbours(hider)].filter((i) => i !== TENT);
  return near[Math.floor(rng() * near.length)];
}

// ---- Scoring ---------------------------------------------------------------------------------

export const FIND_BASE = 200;
export const FIND_PER_SEC = 15;
export const HIDE_PER_SEC = 10;
export const NEVER_FOUND_BONUS = 300;

export function findPoints(msLeft: number): number {
  return FIND_BASE + Math.round(Math.max(0, msLeft) / 1000) * FIND_PER_SEC;
}

export function hidePoints(msHidden: number, found: boolean): number {
  return Math.round(Math.max(0, msHidden) / 1000) * HIDE_PER_SEC + (found ? 0 : NEVER_FOUND_BONUS);
}

/** Who hides each round: everyone once (in join order), or two rounds for a tournament. */
export function hiderOrder(ids: string[], short: boolean): string[] {
  return short ? ids.slice(0, Math.min(2, ids.length)) : ids.slice();
}

// ---- Krampuslauf ------------------------------------------------------------------------------

export const LAUF_LEAD_MS = 3_500;
export const LAUF_MS = 14_000;
/** Distance to the finish, and how far you skate per second while holding. */
export const LAUF_GOAL = 100;
export const LAUF_SPEED = 12;
/** Let go within this long after Krampus turns, or he catches you. */
export const LAUF_GRACE_MS = 300;
/** Caught: pushed back this far. */
export const LAUF_PENALTY = 20;
export const LAUF_POINTS = [150, 100, 60, 30];

/** When Krampus looks: [start, end] ms from the start of the race. Fair for everyone (same schedule). */
export function lookSchedule(rng: Rng): [number, number][] {
  const out: [number, number][] = [];
  let t = 1800 + rng() * 1200;
  while (t < LAUF_MS - 900) {
    const len = 1000 + rng() * 1000;
    out.push([Math.round(t), Math.round(Math.min(LAUF_MS, t + len))]);
    t += len + 1300 + rng() * 1800;
  }
  return out;
}

/** Krampus is looking at time `t` (ms from the start). */
export function looking(schedule: [number, number][], t: number): boolean {
  return schedule.some(([a, b]) => t >= a && t < b);
}

/**
 * Replay a run: `holds` are [press, release] ms from the start (release null: still held at the end).
 * Holding while he looks (after the grace) gets you caught: pushed back, and you have to let go.
 */
export function simulateLauf(holds: [number, number | null][], schedule: [number, number][]): { dist: number; caught: number } {
  let dist = 0;
  let caught = 0;
  const sorted = holds
    .filter((h) => Array.isArray(h) && Number.isFinite(h[0]))
    .map(([p, r]): [number, number] => [Math.max(0, p), Math.min(LAUF_MS, r ?? LAUF_MS)])
    .filter(([p, r]) => r > p && p < LAUF_MS)
    .sort((a, b) => a[0] - b[0]);
  let busyUntil = 0;
  for (const [p, r] of sorted) {
    const press = Math.max(p, busyUntil);
    if (r <= press) continue;
    busyUntil = r;
    // Pressing while he's already looking: caught straight away.
    if (looking(schedule, press)) {
      caught++;
      dist = Math.max(0, dist - LAUF_PENALTY);
      continue;
    }
    // Still holding when he turns round (after the grace): caught at that moment.
    const turn = schedule.find(([a]) => a > press && a + LAUF_GRACE_MS < r);
    if (turn) {
      dist = Math.min(LAUF_GOAL, dist + ((turn[0] - press) / 1000) * LAUF_SPEED);
      if (dist >= LAUF_GOAL) break;
      caught++;
      dist = Math.max(0, dist - LAUF_PENALTY);
      continue;
    }
    dist = Math.min(LAUF_GOAL, dist + ((r - press) / 1000) * LAUF_SPEED);
    if (dist >= LAUF_GOAL) break;
  }
  return { dist: Math.round(dist * 10) / 10, caught };
}

/** Points for the race by place (furthest first, ties share). */
export function laufPoints(dists: Record<string, number>): Record<string, number> {
  const ids = Object.keys(dists);
  const out: Record<string, number> = {};
  for (const id of ids) {
    const better = ids.filter((o) => dists[o] > dists[id]).length;
    out[id] = dists[id] > 0 ? (LAUF_POINTS[better] ?? 15) : 0;
  }
  return out;
}

export function howTo(short: boolean): string[] {
  return [
    'One pierogi hides at the Christmas market. Everyone else hunts, stall to stall',
    'Sniff for hot or cold. The hider fakes sightings and sends the watch seller after you',
    `Enter the Krampus tent and everyone skates: freeze when he looks! · ${short ? '2 rounds' : 'everyone hides once'}`,
  ];
}
