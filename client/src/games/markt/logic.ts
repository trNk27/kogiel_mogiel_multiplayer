/**
 * Wo ist der Pieróg? Hide-and-seek at the Vienna Christmas market. Pure rules, no DOM.
 *
 * Each round one pierogi hides at a stall (secretly, on their phone) and everyone else hunts for it,
 * walking stall to stall through the crowds. Seekers can sniff for a hot/cold clue that only they see.
 * The hider fights back with tricks: a fake sighting on the TV, sending the watch seller to block a
 * seeker, or sneaking to the next stall. Walk into the Krampus tent and everyone is pulled onto the
 * ice rink to dodge Krampus: jump, duck or swerve. Built for playing over a video
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

// ---- Krampus auf dem Eis ---------------------------------------------------------------------

/**
 * Everyone skates laps round the ice rink while Krampus, in the middle, attacks. Each attack shows on
 * the TV and on every phone at the same moment; you tap the right move in time or fall on your bum.
 * Your tap is timed on your phone against the host clock, so video-call lag doesn't matter.
 */
export type Move = 'jump' | 'duck' | 'swerve';
export const MOVES: readonly { id: Move; emoji: string; label: string }[] = [
  { id: 'jump', emoji: '🦘', label: 'JUMP' },
  { id: 'duck', emoji: '🙇', label: 'DUCK' },
  { id: 'swerve', emoji: '↪️', label: 'SWERVE' },
];
export interface Attack {
  emoji: string;
  text: string;
  dodge: Move;
}
export const ATTACKS: readonly Attack[] = [
  { emoji: '🌿', text: 'Birch switch, low!', dodge: 'jump' },
  { emoji: '⛓️', text: 'Chains, high!', dodge: 'duck' },
  { emoji: '❄️', text: 'Snowball!', dodge: 'swerve' },
];

export const LAUF_LEAD_MS = 4_000;
export const LAUF_ATTACKS = 8;
/** Time between attacks, and how long you have to react. */
export const ATTACK_EVERY_MS = 2_600;
export const DODGE_MS = 1_500;
export const LAUF_MS = LAUF_ATTACKS * ATTACK_EVERY_MS + 1_200;
/** Points per dodge, plus a bonus for quick ones. */
export const DODGE_POINTS = 40;
export const QUICK_MS = 700;
export const QUICK_BONUS = 20;

/** The attacks: [ms after the start, attack index]. Never the same one three times running. */
export function attackSchedule(rng: Rng): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < LAUF_ATTACKS; i++) {
    let k = Math.floor(rng() * ATTACKS.length);
    if (i >= 2 && out[i - 1][1] === k && out[i - 2][1] === k) k = (k + 1) % ATTACKS.length;
    out.push([800 + i * ATTACK_EVERY_MS, k]);
  }
  return out;
}

/** Points for one reaction: `at` ms after the attack showed (null: no reaction). */
export function dodgePoints(attack: number, pick: Move | null, at: number | null): number {
  if (pick === null || at === null || at < 0 || at > DODGE_MS) return 0;
  if (ATTACKS[attack]?.dodge !== pick) return 0;
  return DODGE_POINTS + (at <= QUICK_MS ? QUICK_BONUS : 0);
}

/** How far round the rink a skater is, in laps: everyone glides, dodges push you on, falls cost you. */
export function lapsAt(elapsedMs: number, dodged: number, fell: number): number {
  const t = Math.max(0, Math.min(LAUF_MS, elapsedMs)) / LAUF_MS;
  return Math.max(0, t * 1.4 + dodged * 0.07 - fell * 0.05);
}

/** Points for the race by place (most dodge points first, ties share). */
export function laufPoints(scores: Record<string, number>): Record<string, number> {
  const ids = Object.keys(scores);
  const out: Record<string, number> = {};
  for (const id of ids) {
    const better = ids.filter((o) => scores[o] > scores[id]).length;
    out[id] = scores[id] + (scores[id] > 0 ? ([100, 60, 30][better] ?? 0) : 0);
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
