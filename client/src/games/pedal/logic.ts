/** Tour de Pierogi: pedal by tapping LEFT and RIGHT in turn. First across the line wins the heat. */

/** Pedal strokes from the start to the finish line. */
export const PEDAL_GOAL = 100;
export const PEDAL_HEATS = 3;
/** Tournament version: one heat. */
export const PEDAL_HEATS_SHORT = 1;
/** The fastest believable pedalling, in strokes per second. Anything faster is capped. */
export const PEDAL_MAX_RATE = 16;
export const PEDAL_COUNTDOWN_MS = 3500;
/** A heat ends this long after the start, whoever is still pedalling. */
export const PEDAL_LIMIT_MS = 45_000;
/** Once someone has finished, the others get this long. */
export const PEDAL_GRACE_MS = 8_000;
/** Points per heat for 1st, 2nd, 3rd… */
export const HEAT_POINTS = [10, 8, 6, 5, 4, 3, 2, 1] as const;

export type Side = 'l' | 'r';

/** A press counts as a stroke only if it's the other pedal from the last one. */
export function isStroke(last: Side | null, side: Side): boolean {
  return last !== side;
}

/**
 * How many strokes the host believes: never more than the goal, never fewer than before,
 * and never faster than PEDAL_MAX_RATE since the start (plus a little slack).
 */
export function acceptStrokes(prev: number, claimed: number, elapsedMs: number, goal = PEDAL_GOAL): number {
  if (!Number.isFinite(claimed)) return prev;
  const cap = Math.floor((Math.max(0, elapsedMs) / 1000) * PEDAL_MAX_RATE) + 2;
  return Math.max(prev, Math.min(goal, Math.floor(claimed), cap));
}

export function heatPoints(place: number): number {
  return HEAT_POINTS[place - 1] ?? 0;
}

/**
 * Places in a heat: finishers by their time, then everyone else by how far they got.
 * Equal results share a place.
 */
export function heatPlaces(rows: readonly { dist: number; time: number | null }[]): number[] {
  const better = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
    if (a.time !== null && b.time !== null) return a.time < b.time;
    if (a.time !== null) return true;
    if (b.time !== null) return false;
    return a.dist > b.dist;
  };
  return rows.map((r) => 1 + rows.filter((o) => better(o, r)).length);
}
