import type { Rng } from '../rng';
import { shuffle } from '../quiz/logic';

/**
 * Podmianka ("the swap"): eight things on the shelves, a curtain, and one of them is swapped
 * for something new. Find the new one.
 */

export interface SwapItem {
  id: string;
  name: string;
  /** Sprite URL (served from client/public). */
  src: string;
  /** Things in the same group look alike: later rounds swap within a group. */
  group: 'jar' | 'bake' | 'veg' | 'fruit' | 'tool' | 'pottery' | 'cook' | 'deli' | 'odd';
}

const K = (id: string, name: string, group: SwapItem['group']): SwapItem => ({ id: `k-${id}`, name, src: `/sprites/kitchen/${id}.webp`, group });
const S = (id: string, name: string, group: SwapItem['group']): SwapItem => ({ id, name, src: `/sprites/swap/${id}.webp`, group });

/** Pierogi Panic sprites plus the Podmianka set (tools/sprites/swap.py), all in one painted style. */
export const SWAP_ITEMS: readonly SwapItem[] = [
  K('dough', 'Dough', 'bake'),
  K('flour', 'Flour', 'bake'),
  K('raw', 'Raw pierogi', 'bake'),
  K('pin', 'Rolling pin', 'tool'),
  K('bell', 'Bell', 'odd'),
  K('bin', 'Bin', 'odd'),
  K('pot', 'Pot', 'cook'),
  K('pot-cooked', 'Pot of pierogi', 'cook'),
  K('pan', 'Frying pan', 'cook'),
  K('fried-pan', 'Pan of fried pierogi', 'cook'),
  K('plate', 'Plate', 'pottery'),
  K('plate-boiled', 'Boiled pierogi', 'pottery'),
  K('plate-fried', 'Fried pierogi', 'pottery'),
  K('fill-potato', 'Potato filling', 'pottery'),
  K('fill-berry', 'Blueberry filling', 'pottery'),
  K('ing-potato', 'Potatoes & cheese', 'veg'),
  K('ing-cabbage', 'Cabbage', 'veg'),
  K('ing-meat', 'Meat', 'deli'),
  K('ing-berry', 'Blueberries', 'fruit'),
  K('crate-potato', 'Crate of potatoes', 'veg'),
  S('pickles', 'Pickles', 'jar'),
  S('jam', 'Jam', 'jar'),
  S('kompot', 'Kompot', 'jar'),
  S('honey', 'Honey', 'jar'),
  S('milk', 'Milk', 'jar'),
  S('kielbasa', 'Kiełbasa', 'deli'),
  S('oscypek', 'Oscypek', 'deli'),
  S('cabbage-rolls', 'Gołąbki', 'deli'),
  S('bread', 'Rye bread', 'bake'),
  S('babka', 'Babka', 'bake'),
  S('paczek', 'Pączek', 'bake'),
  S('makowiec', 'Makowiec', 'bake'),
  S('gingerbread', 'Gingerbread', 'bake'),
  S('teapot', 'Teapot', 'pottery'),
  S('sugar', 'Sugar bowl', 'pottery'),
  S('kettle', 'Kettle', 'cook'),
  S('tea', 'Glass of tea', 'odd'),
  S('spoon', 'Wooden spoons', 'tool'),
  S('whisk', 'Whisk', 'tool'),
  S('grater', 'Grater', 'tool'),
  S('sieve', 'Sieve', 'tool'),
  S('cutlery', 'Knife & fork', 'tool'),
  S('mortar', 'Mortar', 'tool'),
  S('eggs', 'Eggs', 'odd'),
  S('garlic', 'Garlic', 'veg'),
  S('onion', 'Onions', 'veg'),
  S('beetroot', 'Beetroots', 'veg'),
  S('carrots', 'Carrots', 'veg'),
  S('radishes', 'Radishes', 'veg'),
  S('cucumbers', 'Cucumbers', 'veg'),
  S('mushrooms', 'Mushrooms', 'veg'),
  S('apples', 'Apples', 'fruit'),
  S('plums', 'Plums', 'fruit'),
  S('grinder', 'Coffee grinder', 'odd'),
  S('scale', 'Scales', 'odd'),
  S('clock', 'Cuckoo clock', 'odd'),
];

export const SWAP_SLOTS = 8;
export const SWAP_ROUNDS = 8;
export const SWAP_ROUNDS_SHORT = 4;
export const SWAP_CURTAIN_MS = 2800;
/** The swap happens while the curtain is fully closed. */
export const SWAP_CLOSED_AT = 1300;
export const SWAP_PICK_MS = 15_000;
export const SWAP_MAX_POINTS = 1000;
export const SWAP_MIN_POINTS = 500;

export interface SwapRound {
  /** What's on the shelves before the curtain… */
  before: SwapItem[];
  /** …and after. */
  after: SwapItem[];
  /** Index in `after` of the new thing. */
  answer: number;
  /** What it replaced. */
  removed: SwapItem;
  /** How long to look before the curtain (ms). */
  lookMs: number;
  /** Whether the shelves were rearranged too. */
  shuffled: boolean;
  /** Whether the new thing looks like the one it replaced. */
  lookalike: boolean;
}

/**
 * Difficulty for round `i` (0-based) of `n`: the look time shrinks from 9 s to 5 s, the
 * shelves get rearranged from a third of the way in, and in the second half the new thing
 * is a lookalike of the old one.
 */
export function swapDifficulty(i: number, n: number) {
  const t = n > 1 ? i / (n - 1) : 0.5;
  return { lookMs: Math.round(9000 - 4000 * t), shuffled: t >= 0.3, lookalike: t >= 0.5 };
}

/**
 * Make one round. `fresh` holds ids not yet used as the new thing this game (mutated), so
 * the answer never repeats.
 */
export function makeRound(i: number, n: number, rng: Rng = Math.random, fresh: Set<string> = new Set(SWAP_ITEMS.map((x) => x.id))): SwapRound {
  const d = swapDifficulty(i, n);
  const pool = shuffle(SWAP_ITEMS, rng);
  const before = pool.slice(0, SWAP_SLOTS);
  const rest = pool.slice(SWAP_SLOTS);
  const candidates = rest.filter((x) => fresh.has(x.id));
  const spare = candidates.length ? candidates : rest;

  let removedAt = Math.floor(rng() * SWAP_SLOTS);
  let added = spare[0];
  let lookalike = false;
  if (d.lookalike) {
    // Find a shelf item with a lookalike waiting in the wings.
    const order = shuffle(
      before.map((_, k) => k),
      rng,
    );
    for (const k of order) {
      const twin = spare.find((x) => x.group === before[k].group);
      if (twin) {
        removedAt = k;
        added = twin;
        lookalike = true;
        break;
      }
    }
  }
  fresh.delete(added.id);
  const removed = before[removedAt];
  let after = before.map((x, k) => (k === removedAt ? added : x));
  if (d.shuffled) {
    // Rearrange until the new thing isn't simply in the old one's place.
    for (let tries = 0; tries < 10; tries++) {
      after = shuffle(after, rng);
      if (after[removedAt] !== added) break;
    }
  }
  return { before, after, answer: after.indexOf(added), removed, lookMs: d.lookMs, shuffled: d.shuffled, lookalike };
}

/** Points for a right answer `elapsedMs` after the curtain opened. Wrong or none: 0. */
export function swapPoints(correct: boolean, elapsedMs: number, limitMs = SWAP_PICK_MS): number {
  if (!correct) return 0;
  const t = Math.min(1, Math.max(0, elapsedMs / limitMs));
  return Math.round(SWAP_MAX_POINTS - (SWAP_MAX_POINTS - SWAP_MIN_POINTS) * t);
}
