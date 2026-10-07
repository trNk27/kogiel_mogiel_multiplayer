import type { Rng } from '../rng';

/**
 * Pierogi Parade: pierogi of every colour march down a busy market street on the TV. Tap your phone
 * once for every pierogi of the target colour walking on the street. The closer your count, the more
 * points. Lamp posts, trees, market stalls and trams hide them for a moment; balloons, pierogi kites,
 * birds and fireworks try to distract you.
 */

export const PARADE_ROUNDS = 3;
/** Tournament version: one medium round. */
export const PARADE_ROUNDS_SHORT = 1;
export const PARADE_LANES = 5;
/** Showing the target colour before the parade starts. */
export const PARADE_READY_MS = 4500;
/** Counting stays open this long after the last pierogi has left. */
export const PARADE_GRACE_MS = 2500;
/** Points by how far off your count is: exact, 1 off, 2 off, 3 off. */
export const PARADE_POINTS = [10, 6, 3, 1] as const;

export const PARADE_COLORS = [
  { name: 'golden', hex: '#f3cf6b' },
  { name: 'beetroot', hex: '#ff3d6e' },
  { name: 'blueberry', hex: '#4f9dff' },
  { name: 'pickle', hex: '#a3e048' },
  { name: 'plum', hex: '#b27bff' },
] as const;

export interface Marcher {
  /** Index in PARADE_COLORS. */
  c: number;
  /** 0 is the back of the street, PARADE_LANES - 1 the front. */
  lane: number;
  /** ms after the parade starts. */
  at: number;
  /** ms to cross the screen. */
  dur: number;
  /** 1 = left to right, -1 = right to left. */
  dir: 1 | -1;
  size: number;
  /** Hops instead of waddling. */
  hop: boolean;
}

/** Something standing on the street in front of lane `lane` (and hiding it, and the lanes behind). */
export interface Prop {
  kind: 'lamp' | 'tree' | 'stall' | 'barrels';
  /** Centre, as a share of the screen width. */
  x: number;
  lane: number;
}

/** A tram rattling across in front of lane `lane`. Fast, so it never hides anyone for long. */
export interface Tram {
  at: number;
  dur: number;
  dir: 1 | -1;
  lane: number;
}

/** Background distractions. None of them count. */
export interface Scene {
  props: Prop[];
  trams: Tram[];
  /** Balloons drifting up from the street, in the parade colours. */
  balloons: { c: number; x: number; at: number; dur: number }[];
  /** Pierogi-shaped kites in the sky – they look the part, but they're not on the street. `y` is 0..1 down the sky. */
  kites: { c: number; x: number; y: number }[];
  /** Flocks of pigeons crossing the sky. */
  birds: { at: number; dur: number; y: number; dir: 1 | -1; n: number }[];
  fireworks: { c: number; x: number; y: number; at: number }[];
}

export interface Parade {
  target: number;
  answer: number;
  marchers: Marcher[];
  scene: Scene;
  /** ms until the last pierogi has left the screen. */
  length: number;
}

type Range = readonly [number, number];

interface Level {
  targets: Range;
  decoys: Range;
  colours: number;
  speed: Range;
  window: number;
  both: boolean;
  /** Most pierogi marching together in one tight group. */
  group: number;
  /** Share of pierogi that march in groups. */
  grouped: number;
  props: Range;
  trams: Range;
  balloons: Range;
  kites: Range;
  birds: Range;
  fireworks: Range;
}

const LEVELS: readonly Level[] = [
  {
    targets: [6, 10], decoys: [8, 12], colours: 2, speed: [2900, 3800], window: 11_000, both: false,
    group: 2, grouped: 0.2, props: [2, 2], trams: [0, 0], balloons: [3, 5], kites: [0, 1], birds: [1, 2], fireworks: [0, 0],
  },
  {
    targets: [10, 15], decoys: [18, 26], colours: 3, speed: [2200, 3200], window: 12_500, both: true,
    group: 3, grouped: 0.4, props: [3, 4], trams: [1, 1], balloons: [6, 9], kites: [2, 3], birds: [2, 3], fireworks: [2, 4],
  },
  {
    targets: [14, 20], decoys: [28, 38], colours: 5, speed: [1700, 2700], window: 14_000, both: true,
    group: 4, grouped: 0.55, props: [4, 6], trams: [2, 3], balloons: [10, 14], kites: [3, 4], birds: [3, 4], fireworks: [6, 9],
  },
];

const between = (rng: Rng, [a, b]: Range) => a + Math.floor(rng() * (b - a + 1));
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];

function shuffle<T>(xs: T[], rng: Rng): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

/** Make round `round` (0-based; later rounds are longer, faster and busier). */
export function makeParade(round: number, rng: Rng = Math.random): Parade {
  const d = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, round))];
  const target = Math.floor(rng() * PARADE_COLORS.length);
  const others = shuffle(
    PARADE_COLORS.map((_, i) => i).filter((i) => i !== target),
    rng,
  );
  const decoyColours = others.slice(0, Math.max(1, d.colours - 1));
  const answer = between(rng, d.targets);
  const decoys = between(rng, d.decoys);

  // Everybody who marches, in random order, then cut into groups that walk close together.
  const colours = shuffle([...Array.from({ length: answer }, () => target), ...Array.from({ length: decoys }, (_, i) => decoyColours[i % decoyColours.length])], rng);
  const groups: number[][] = [];
  for (let i = 0; i < colours.length; ) {
    const size = rng() < d.grouped ? 2 + Math.floor(rng() * (d.group - 1)) : 1;
    groups.push(colours.slice(i, i + size));
    i += size;
  }

  const marchers: Marcher[] = [];
  // With traffic both ways, odd lanes walk right to left, so nobody walks through anybody.
  const laneDir = (lane: number): 1 | -1 => (d.both && lane % 2 === 1 ? -1 : 1);
  const fits = (ms: Marcher[]) => ms.every((m) => marchers.every((o) => o.lane !== m.lane || apart(o, m)));
  const place = (group: number[]) => {
    const dur = between(rng, d.speed);
    const hop = rng() < 0.3;
    // Members follow each other a little more than the minimum gap apart.
    const step = Math.ceil(dur * GAP * 1.2);
    let at = Math.round(rng() * d.window);
    const lanes = shuffle(
      Array.from({ length: PARADE_LANES }, (_, i) => i),
      rng,
    );
    const make = (lane: number, start: number) =>
      group.map((c, k): Marcher => ({ c, lane, at: start + k * step, dur, dir: laneDir(lane), size: 0.8 + rng() * 0.4, hop }));
    for (let tries = 0; tries < 80; tries++, at += 250) {
      for (const lane of lanes) {
        const ms = make(lane, at);
        if (fits(ms)) return void marchers.push(...ms);
      }
    }
    // Couldn't fit the group: march its members one by one instead.
    for (const c of group) place([c]);
  };
  for (const g of groups) place(g);
  marchers.sort((a, b) => a.at - b.at);
  const length = Math.max(...marchers.map((m) => m.at + m.dur));

  return { target, answer, marchers, scene: makeScene(d, length, rng), length };
}

function makeScene(d: Level, length: number, rng: Rng): Scene {
  // Props stand in different spots, never at the edges, so every pierogi can be seen walking on and off.
  const props: Prop[] = [];
  const nProps = between(rng, d.props);
  const slots = shuffle([0.2, 0.32, 0.44, 0.56, 0.68, 0.8], rng);
  for (let i = 0; i < nProps; i++) {
    props.push({ kind: pick(rng, ['lamp', 'tree', 'stall', 'barrels'] as const), x: slots[i % slots.length] + (rng() - 0.5) * 0.04, lane: Math.floor(rng() * PARADE_LANES) });
  }
  const trams: Tram[] = Array.from({ length: between(rng, d.trams) }, () => ({
    at: Math.round(1500 + rng() * Math.max(0, length - 3000)),
    dur: 1300 + Math.floor(rng() * 300),
    dir: rng() < 0.5 ? 1 : -1,
    lane: 1 + Math.floor(rng() * (PARADE_LANES - 1)),
  }));
  const balloons = Array.from({ length: between(rng, d.balloons) }, () => ({
    c: Math.floor(rng() * PARADE_COLORS.length),
    x: 0.05 + rng() * 0.9,
    at: Math.round(rng() * length),
    dur: 6000 + Math.floor(rng() * 4000),
  }));
  const kites = Array.from({ length: between(rng, d.kites) }, (_, i) => ({
    c: Math.floor(rng() * PARADE_COLORS.length),
    x: (i + 0.5) / 4 + (rng() - 0.5) * 0.12,
    y: rng(),
  }));
  const birds = Array.from({ length: between(rng, d.birds) }, () => ({
    at: Math.round(rng() * length),
    dur: 5000 + Math.floor(rng() * 3000),
    y: rng(),
    dir: (rng() < 0.5 ? 1 : -1) as 1 | -1,
    n: 3 + Math.floor(rng() * 5),
  }));
  const fireworks = Array.from({ length: between(rng, d.fireworks) }, () => ({
    c: Math.floor(rng() * PARADE_COLORS.length),
    x: 0.1 + rng() * 0.8,
    y: rng(),
    at: Math.round(rng() * length),
  }));
  return { props, trams, balloons, kites, birds, fireworks };
}

/** How far apart two pierogi in one lane must stay, as a share of the walk across. */
const GAP = 0.1;

/** Two pierogi in the same lane never overlap (one never catches up with the other). */
function apart(a: Marcher, b: Marcher): boolean {
  const [p, q] = a.at <= b.at ? [a, b] : [b, a];
  // Where the first one is when the second walks on, and where the second is when the first walks off.
  const pWhenQEnters = (q.at - p.at) / p.dur;
  if (pWhenQEnters >= 1 + GAP) return true;
  const qWhenPLeaves = (p.at + p.dur - q.at) / q.dur;
  return pWhenQEnters >= GAP && 1 - qWhenPLeaves >= GAP;
}

export function paradePoints(guess: number, answer: number): number {
  return PARADE_POINTS[Math.abs(guess - answer)] ?? 0;
}

/** A count the host accepts from a phone. */
export function validCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 99;
}
