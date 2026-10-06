import type { Rng } from '../rng';

/**
 * Pierogi Parade: pierogi of every colour march across the TV. Tap your phone once for every
 * pierogi of the target colour. The closer your count, the more points.
 */

export const PARADE_ROUNDS = 3;
/** Tournament version: one medium round. */
export const PARADE_ROUNDS_SHORT = 1;
export const PARADE_LANES = 5;
/** Showing the target colour before the parade starts. */
export const PARADE_READY_MS = 3500;
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

export interface Parade {
  target: number;
  answer: number;
  marchers: Marcher[];
  /** ms until the last pierogi has left the screen. */
  length: number;
}

const DIFFICULTY = [
  { targets: [6, 10], decoys: [8, 12], colours: 2, speed: [2900, 3800], window: 11_000, both: false },
  { targets: [9, 14], decoys: [14, 20], colours: 3, speed: [2200, 3200], window: 12_500, both: true },
  { targets: [12, 18], decoys: [20, 28], colours: 5, speed: [1700, 2700], window: 14_000, both: true },
] as const;

const between = (rng: Rng, [a, b]: readonly [number, number]) => a + Math.floor(rng() * (b - a + 1));

/** Make round `round` (0-based; later rounds are longer, faster and busier). */
export function makeParade(round: number, rng: Rng = Math.random): Parade {
  const d = DIFFICULTY[Math.max(0, Math.min(DIFFICULTY.length - 1, round))];
  const target = Math.floor(rng() * PARADE_COLORS.length);
  const others = PARADE_COLORS.map((_, i) => i).filter((i) => i !== target);
  // Shuffle the decoy colours and keep a few.
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const decoyColours = others.slice(0, Math.max(1, d.colours - 1));
  const answer = between(rng, d.targets);
  const decoys = between(rng, d.decoys);
  const marchers: Marcher[] = [];
  // With traffic both ways, odd lanes walk right to left, so nobody walks through anybody.
  const laneDir = (lane: number): 1 | -1 => (d.both && lane % 2 === 1 ? -1 : 1);
  const fits = (m: Marcher) => marchers.every((o) => o.lane !== m.lane || apart(o, m));
  const add = (c: number) => {
    const dur = between(rng, d.speed);
    const size = 0.75 + rng() * 0.45;
    const hop = rng() < 0.3;
    let at = Math.round(rng() * d.window);
    const lanes = Array.from({ length: PARADE_LANES }, (_, i) => i).sort(() => rng() - 0.5);
    for (let tries = 0; tries < 60; tries++, at += 250) {
      for (const lane of lanes) {
        const m: Marcher = { c, lane, at, dur, dir: laneDir(lane), size, hop };
        if (fits(m)) return void marchers.push(m);
      }
    }
    marchers.push({ c, lane: lanes[0], at, dur, dir: laneDir(lanes[0]), size, hop });
  };
  for (let i = 0; i < answer; i++) add(target);
  for (let i = 0; i < decoys; i++) add(decoyColours[i % decoyColours.length]);
  marchers.sort((a, b) => a.at - b.at);
  const length = Math.max(...marchers.map((m) => m.at + m.dur));
  return { target, answer, marchers, length };
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
