/**
 * Wybredna Baja ("picky Baja"): pure rules. No DOM.
 *
 * A team game. Baja has a secret craving: one option for each part of the plate (food, how it's
 * served, how she gets it, and with 4+ players a trick first). Everyone builds ONE plate together:
 * each part belongs to one player, but your secret clues are always about other people's parts, so
 * you have to talk and trade what you know. Treats buy Baja's trust: she whispers you a sure clue.
 * She tastes the team plate and her reaction says how many parts were right; three tries.
 *
 * From the second craving one player is secretly the neighbour's cat, who wants Baja to stay hungry:
 * the cat gets real clues but can lie, or quietly pick wrong. After each cat round everyone votes.
 */
import { mulberry32, type Rng } from '../rng';

export { mulberry32 };
export type { Rng };

export interface BajaOption {
  id: string;
  emoji: string;
  label: string;
}

export interface BajaRow {
  id: 'food' | 'serve' | 'how' | 'trick';
  /** Short name for the row, e.g. on the phone and in "Baja changed her mind about …". */
  title: string;
  options: BajaOption[];
}

export const ROWS: readonly BajaRow[] = [
  {
    id: 'food',
    title: 'Food',
    options: [
      { id: 'chicken', emoji: '🍗', label: 'Chicken' },
      { id: 'cheese', emoji: '🧀', label: 'Cheese' },
      { id: 'kielbasa', emoji: '🌭', label: 'Kiełbasa' },
      { id: 'carrot', emoji: '🥕', label: 'Carrot' },
      { id: 'apple', emoji: '🍎', label: 'Apple' },
      { id: 'ham', emoji: '🥓', label: 'Ham' },
    ],
  },
  {
    id: 'serve',
    title: 'Served',
    options: [
      { id: 'warm', emoji: '♨️', label: 'Warm' },
      { id: 'cold', emoji: '❄️', label: 'Cold' },
      { id: 'tiny', emoji: '🔪', label: 'Tiny pieces' },
    ],
  },
  {
    id: 'how',
    title: 'How',
    options: [
      { id: 'hand', emoji: '✋', label: 'From your hand' },
      { id: 'bowl', emoji: '🥣', label: 'In her bowl' },
      { id: 'floor', emoji: '👇', label: 'On the floor' },
    ],
  },
  {
    id: 'trick',
    title: 'Trick first',
    options: [
      { id: 'dance', emoji: '💃', label: 'A little dance' },
      { id: 'paw', emoji: '🐾', label: 'Give paw' },
      { id: 'spin', emoji: '🌀', label: 'Spin around' },
    ],
  },
];

/** Full game / tournament version. */
export const BAJA_ROUNDS = 4;
export const BAJA_ROUNDS_SHORT = 2;
/** Tries per craving, and what feeding her on each is worth to the team. */
export const BAJA_TRIES = 3;
export const TRY_POINTS = [600, 400, 200];
/** Time to build the plate together, ms. */
export const BUILD_MS = 50_000;
/** Treats each player has for the whole game. */
export const TREATS = 3;
/** The cat joins from this craving (1-based), if there are enough players. */
export const CAT_FROM_ROUND = 2;
export const CAT_MIN_PLAYERS = 3;
/** The cat: points for every failed try, a bonus if Baja is never fed, and for fooling the vote. */
export const CAT_PER_MISS = 200;
export const CAT_STARVED_BONUS = 300;
export const CAT_FOOLED_BONUS = 300;
/** Voting for the cat correctly. */
export const VOTE_RIGHT = 150;

/** How many parts the plate has: the trick joins with 4+ players. */
export function partsFor(players: number): number {
  return players >= 4 ? 4 : 3;
}

/** Who owns each part: round-robin over a shuffled order, so everyone gets a turn at each part. */
export function owners(order: string[], parts: number): string[] {
  return Array.from({ length: parts }, (_, i) => order[i % order.length]);
}

export function shuffle<T>(xs: T[], rng: Rng): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function makeCraving(parts: number, rng: Rng): number[] {
  return ROWS.slice(0, parts).map((r) => Math.floor(rng() * r.options.length));
}

export interface Clue {
  part: number;
  /** Options she does NOT want, or the one she does (`is`). */
  not?: number[];
  is?: number;
}

export function clueText(c: Clue): string {
  const row = ROWS[c.part];
  if (c.is !== undefined) return `${row.title}: she wants ${row.options[c.is].emoji} ${row.options[c.is].label}!`;
  const names = (c.not ?? []).map((o) => `${row.options[o].emoji} ${row.options[o].label}`);
  return `${row.title}: not ${names.join(' or ')}`;
}

/**
 * Deal the clues. For every part, the options she doesn't want are split into little cards and dealt
 * to the players who DON'T own that part (unless nobody else exists). All cards together pin down
 * the craving, so the team can solve it if everyone shares (and nobody lies).
 */
export function dealClues(craving: number[], own: string[], ids: string[], rng: Rng): Record<string, Clue[]> {
  const out: Record<string, Clue[]> = {};
  for (const id of ids) out[id] = [];
  craving.forEach((ans, part) => {
    const n = ROWS[part].options.length;
    const wrong = shuffle(
      Array.from({ length: n }, (_, i) => i).filter((i) => i !== ans),
      rng,
    );
    // Food has 5 wrong options: cards of 2, 2, 1. The others have 2: one card each.
    const sizes = wrong.length >= 5 ? [2, 2, wrong.length - 4] : wrong.map(() => 1);
    let holders = ids.filter((id) => id !== own[part]);
    if (!holders.length) holders = ids.slice();
    holders = shuffle(holders, rng);
    let k = 0;
    sizes.forEach((size, card) => {
      const not = wrong.slice(k, k + size).sort((a, b) => a - b);
      k += size;
      out[holders[card % holders.length]].push({ part, not });
    });
  });
  for (const id of ids) out[id].sort((a, b) => a.part - b.part);
  return out;
}

/** A treat: Baja trusts you and whispers the answer for a part you don't know yet (yours too). */
export function treatClue(craving: number[], known: Clue[], rng: Rng): Clue | null {
  const sure = new Set(known.filter((c) => c.is !== undefined).map((c) => c.part));
  const open = craving.map((_, i) => i).filter((i) => !sure.has(i));
  if (!open.length) return null;
  const part = open[Math.floor(rng() * open.length)];
  return { part, is: craving[part] };
}

/** Whether a plate is well formed for a craving with `parts` parts. */
export function validPlate(plate: unknown, parts: number): plate is number[] {
  return (
    Array.isArray(plate) &&
    plate.length === parts &&
    plate.every((v, i) => Number.isInteger(v) && v >= 0 && v < ROWS[i].options.length)
  );
}

/** How many parts of the plate she likes. */
export function hits(plate: number[], craving: number[]): number {
  let n = 0;
  for (let i = 0; i < craving.length; i++) if (plate[i] === craving[i]) n++;
  return n;
}

export type Reaction = 'snub' | 'lick' | 'spit' | 'eat';

/** Baja's reaction to a plate with `h` of `parts` right. */
export function reactionFor(h: number, parts: number): Reaction {
  if (h >= parts) return 'eat';
  if (h === 0) return 'snub';
  if (h === 1) return 'lick';
  return 'spit';
}

export function reactionText(r: Reaction): string {
  switch (r) {
    case 'snub':
      return 'Hmph! Not even close.';
    case 'lick':
      return 'One lick… and she walks off.';
    case 'spit':
      return 'Chew, chew… ptfu!';
    case 'eat':
      return 'Nom nom! Zoomies!';
  }
}

export function plateEmoji(plate: (number | null)[]): string[] {
  return plate.map((v, i) => (v === null ? '❓' : (ROWS[i].options[v]?.emoji ?? '?')));
}

/** Team points when Baja is fed on try `tryN` (1-based), 0 if never. */
export function teamPoints(fedOn: number | null): number {
  return fedOn === null ? 0 : (TRY_POINTS[fedOn - 1] ?? 0);
}

/** The cat's points: every failed try, plus a bonus if she starved. */
export function catPoints(fedOn: number | null): number {
  const misses = fedOn === null ? BAJA_TRIES : fedOn - 1;
  return misses * CAT_PER_MISS + (fedOn === null ? CAT_STARVED_BONUS : 0);
}

/** Who got the most votes (ties: everyone tied). */
export function mostVoted(votes: Record<string, string>): string[] {
  const n: Record<string, number> = {};
  for (const v of Object.values(votes)) n[v] = (n[v] ?? 0) + 1;
  const max = Math.max(0, ...Object.values(n));
  return max ? Object.keys(n).filter((id) => n[id] === max) : [];
}

export function howTo(short: boolean): string[] {
  return [
    'Feed Baja together: everyone picks one part of the same plate',
    'Your clues are about OTHER people’s parts. Talk, trade, give treats for sure clues',
    `From craving 2 someone is the neighbour’s cat 🐈 and wants her hungry · ${short ? '2 cravings' : '4 cravings'}`,
  ];
}
