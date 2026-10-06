import type { ForkItem } from '../../../../shared/protocol';
import type { Rng } from '../rng';

/**
 * Fork Fight: a plate on every phone. Something lands on it – stab it if it's a pierogi,
 * leave it if it's a sock. Reaction times are measured on the phone, so Wi-Fi lag doesn't matter.
 */

export type { ForkItem };
export const FORK_FAKES: readonly ForkItem[] = ['sock', 'slipper', 'duck'];

export const FORK_ROUNDS = 8;
/** Tournament version. */
export const FORK_ROUNDS_SHORT = 4;
/** How long a pierogi stays on the plate. Too slow and it's gone. */
export const FORK_LIMIT_MS = 1500;
/** How long a fake stays on the plate. */
export const FORK_FAKE_MS = 900;
/** Phones get the round this long before the plate opens. */
export const FORK_LEAD_MS = 2200;
/** Round points for the fastest, second and third stab. */
export const FORK_POINTS = [3, 2, 1] as const;
/** Stabbing an empty plate or a fake. */
export const FORK_FOUL = -1;

/** Stab codes the phone sends instead of a reaction time. */
export const STAB_EARLY = -1;
export const STAB_FOOLED = -2;

/** Something on the plate, `at` ms after the plate opens, for `dur` ms. */
export interface ForkStep {
  k: ForkItem;
  at: number;
  dur: number;
}

/** One round: a few fakes (more in later rounds), then the pierogi. */
export function makeForkRound(round: number, rng: Rng = Math.random): ForkStep[] {
  const fakeChance = Math.min(0.85, 0.3 + round * 0.08);
  const fakes = rng() < fakeChance ? (rng() < 0.25 + round * 0.04 ? 2 : 1) : 0;
  const steps: ForkStep[] = [];
  let t = 1200 + rng() * 2600;
  for (let i = 0; i < fakes; i++) {
    steps.push({ k: FORK_FAKES[Math.floor(rng() * FORK_FAKES.length)], at: Math.round(t), dur: FORK_FAKE_MS });
    t += FORK_FAKE_MS + 450 + rng() * 1400;
  }
  steps.push({ k: 'pierogi', at: Math.round(t), dur: FORK_LIMIT_MS });
  return steps;
}

/** When the last thing leaves the plate (ms after it opens). */
export function forkRoundLength(steps: readonly ForkStep[]): number {
  return Math.max(0, ...steps.map((s) => s.at + s.dur));
}

/** What a stab means, given ms since the plate opened (phone side). */
export function stabAt(steps: readonly ForkStep[], t: number): { k: ForkItem | null; since: number } {
  for (const s of steps) if (t >= s.at && t < s.at + s.dur) return { k: s.k, since: t - s.at };
  return { k: null, since: 0 };
}

/** Is this a stab the host accepts? A reaction time, or one of the foul codes. */
export function validStab(ms: unknown): ms is number {
  return typeof ms === 'number' && Number.isInteger(ms) && (ms === STAB_EARLY || ms === STAB_FOOLED || (ms >= 0 && ms <= FORK_LIMIT_MS));
}

/**
 * Round points: 3 / 2 / 1 for the fastest stabs (equal times share a place), -1 for a foul,
 * 0 for no stab. Also returns each valid stabber's place.
 */
export function scoreFork(stabs: Record<string, number>): { points: Record<string, number>; places: Record<string, number> } {
  const points: Record<string, number> = {};
  const places: Record<string, number> = {};
  const valid = Object.values(stabs).filter((ms) => ms >= 0);
  for (const [id, ms] of Object.entries(stabs)) {
    if (ms < 0) {
      points[id] = FORK_FOUL;
      continue;
    }
    const place = 1 + valid.filter((o) => o < ms).length;
    places[id] = place;
    points[id] = FORK_POINTS[place - 1] ?? 0;
  }
  return { points, places };
}

/** "0.284 s", or what went wrong. */
export function stabLabel(ms: number | null) {
  if (ms === null) return 'Too slow';
  if (ms === STAB_EARLY) return 'Too early!';
  if (ms < 0) return 'Fooled by a fake!';
  return `${(ms / 1000).toFixed(3)} s`;
}
