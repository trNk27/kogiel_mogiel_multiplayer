/**
 * Wybredna Baja ("picky Baja"): pure rules. No DOM.
 *
 * Baja, a very picky pomchi, has a secret craving: one option from each row (what food, how it's
 * served, how she gets it, and in the last craving a trick first). Everyone builds a plate on their
 * phone at the same time and feeds her; she tastes every plate on the TV and her reaction says how
 * many rows were right (Mastermind-style, but every row is its own slot). Everyone sees everyone's
 * plates, so you learn from each other. Feed her exactly right and you score by how early you did it.
 *
 * Twists: before each craving she turns her nose up at one thing she doesn't want (a free hint), and
 * from the third craving on she changes her mind about one row after the second try.
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
export const BAJA_ROUNDS = 5;
export const BAJA_ROUNDS_SHORT = 2;
/** Tries per craving. */
export const BAJA_TRIES = 5;
/** Points for feeding her right on try 1, 2, 3… */
export const TRY_POINTS = [1000, 800, 600, 400, 200];
/** Time to build a plate, ms. */
export const BUILD_MS = 35_000;
/** From this craving on (1-based) she changes her mind after try MIND_AFTER_TRY. */
export const MIND_FROM_ROUND = 3;
export const MIND_AFTER_TRY = 2;

/** How many rows craving `round` (1-based) of `rounds` uses: the last one is extra picky. */
export function rowsFor(round: number, rounds: number): number {
  return round === rounds ? 4 : 3;
}

export function pointsForTry(tryN: number): number {
  return TRY_POINTS[tryN - 1] ?? 0;
}

export function makeCraving(rows: number, rng: Rng): number[] {
  return ROWS.slice(0, rows).map((r) => Math.floor(rng() * r.options.length));
}

/** A free hint: one row, and an option in it that she does NOT want. */
export function makeHint(craving: number[], rng: Rng): { row: number; opt: number } {
  // Food has the most options, so a hint about food helps the least; prefer it a bit less.
  const row = rng() < 0.5 ? 0 : 1 + Math.floor(rng() * (craving.length - 1));
  const n = ROWS[row].options.length;
  let opt = Math.floor(rng() * (n - 1));
  if (opt >= craving[row]) opt++;
  return { row, opt };
}

/** She changes her mind about one row: returns the new craving and which row changed. */
export function changeMind(craving: number[], rng: Rng): { craving: number[]; row: number } {
  const row = Math.floor(rng() * craving.length);
  const n = ROWS[row].options.length;
  let v = Math.floor(rng() * (n - 1));
  if (v >= craving[row]) v++;
  const next = craving.slice();
  next[row] = v;
  return { craving: next, row };
}

/** Whether a plate is well formed for a craving with `rows` rows. */
export function validPlate(plate: unknown, rows: number): plate is number[] {
  return (
    Array.isArray(plate) &&
    plate.length === rows &&
    plate.every((v, i) => Number.isInteger(v) && v >= 0 && v < ROWS[i].options.length)
  );
}

/** How many rows of the plate she likes. */
export function hits(plate: number[], craving: number[]): number {
  let n = 0;
  for (let i = 0; i < craving.length; i++) if (plate[i] === craving[i]) n++;
  return n;
}

export type Reaction = 'snub' | 'lick' | 'spit' | 'eat';

/** Baja's reaction to a plate with `h` of `rows` right. With four rows, 3 right is still a spit. */
export function reactionFor(h: number, rows: number): Reaction {
  if (h >= rows) return 'eat';
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

export function plateEmoji(plate: number[]): string[] {
  return plate.map((v, i) => ROWS[i].options[v]?.emoji ?? '?');
}

export function plateLabel(plate: number[]): string {
  return plate.map((v, i) => ROWS[i].options[v]?.label ?? '?').join(' · ');
}

export interface Tasting {
  id: string;
  plate: number[];
  hits: number;
  fed: boolean;
  pts: number;
}

/**
 * One craving. Tracks who still has tries, the plates handed in for the current try, and what
 * happened on every try so far.
 */
export class Craving {
  tryN = 1;
  craving: number[];
  readonly rows: number;
  /** Plates for the current try. */
  readonly plates = new Map<string, number[]>();
  /** Every try so far, per player. */
  readonly history = new Map<string, { plate: number[] | null; hits: number }[]>();
  /** Players who fed her right, with the try they did it on. */
  readonly fedOn = new Map<string, number>();
  /** Points earned this craving. */
  readonly pts = new Map<string, number>();
  ids: string[];
  /** Rows she changed her mind about (in order). */
  readonly changed: number[] = [];

  constructor(ids: string[], craving: number[]) {
    this.ids = ids.slice();
    this.craving = craving.slice();
    this.rows = craving.length;
    for (const id of ids) this.history.set(id, []);
  }

  /** Still playing this craving: not fed yet. */
  active(id: string) {
    return this.ids.includes(id) && !this.fedOn.has(id);
  }

  activeIds() {
    return this.ids.filter((id) => this.active(id));
  }

  /** Hand in a plate for the current try. Returns false if it's not allowed. */
  submit(id: string, plate: unknown): boolean {
    if (!this.active(id) || this.plates.has(id) || this.over) return false;
    if (!validPlate(plate, this.rows)) return false;
    this.plates.set(id, plate.slice());
    return true;
  }

  /** Everyone in `present` (connected players) who is still playing has handed in a plate. */
  allIn(present: (id: string) => boolean) {
    const waiting = this.activeIds().filter((id) => present(id));
    return waiting.length > 0 && waiting.every((id) => this.plates.has(id));
  }

  /** Taste the plates of this try, in join order. Players without a plate use up the try. */
  taste(): Tasting[] {
    const out: Tasting[] = [];
    for (const id of this.activeIds()) {
      const plate = this.plates.get(id) ?? null;
      const h = plate ? hits(plate, this.craving) : 0;
      const fed = plate !== null && h === this.rows;
      const pts = fed ? pointsForTry(this.tryN) : 0;
      this.history.get(id)?.push({ plate, hits: h });
      if (plate) out.push({ id, plate, hits: h, fed, pts });
      if (fed) {
        this.fedOn.set(id, this.tryN);
        this.pts.set(id, pts);
      }
    }
    this.plates.clear();
    return out;
  }

  /** Move on to the next try (after tasting). */
  nextTry() {
    this.tryN++;
  }

  /** No more tries, or nobody left to feed her. */
  get over() {
    return this.tryN > BAJA_TRIES || this.activeIds().length === 0;
  }

  setCraving(next: number[], row: number) {
    this.craving = next.slice();
    this.changed.push(row);
  }

  remove(id: string) {
    this.ids = this.ids.filter((x) => x !== id);
    this.plates.delete(id);
  }
}

export function howTo(short: boolean): string[] {
  return [
    'Baja is hungry, but very picky. Build her a plate on your phone',
    'She tastes every plate: snub, lick, spit… or nom nom! Learn from everyone',
    `Feed her right on the first try for 1000 · ${short ? '2 cravings' : '5 cravings'}, the last one extra picky`,
  ];
}
