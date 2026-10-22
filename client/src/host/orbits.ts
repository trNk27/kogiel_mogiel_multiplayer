/**
 * The landing page's solar system: the game icons circle the title on tilted (elliptical) orbits,
 * each ring at its own speed and alternating direction. Pure maths, no DOM.
 *
 * Coordinates are stage pixels from the centre of the screen, +y down. An orbit is drawn as an
 * ellipse, so it looks like a ring seen at an angle: icons at the top are "behind" the title (smaller,
 * dimmer, drawn underneath) and icons at the bottom are in front.
 */

export interface Ring {
  rx: number;
  ry: number;
  /** Radians per second; the sign is the direction. */
  speed: number;
  /** How many of the planets this ring takes, relative to the others. */
  weight: number;
}

/** From the inside out. The inner ring clears the title and the button; the outer one stays on the stage. */
export const RINGS: readonly Ring[] = [
  { rx: 560, ry: 282, speed: 0.15, weight: 7 },
  { rx: 680, ry: 330, speed: -0.105, weight: 9 },
  { rx: 790, ry: 375, speed: 0.072, weight: 11 },
  { rx: 890, ry: 418, speed: -0.05, weight: 12 },
];

export interface Planet {
  ring: number;
  /** Starting angle (radians). */
  phase: number;
}

/** Spread `count` planets over the rings in proportion to their weights, evenly round each ring. */
export function orbitLayout(count: number, rings: readonly Ring[] = RINGS): Planet[] {
  const total = rings.reduce((s, r) => s + r.weight, 0);
  // Largest-remainder split, so the counts always add up to `count`.
  const exact = rings.map((r) => (count * r.weight) / total);
  const sizes = exact.map(Math.floor);
  const order = exact.map((e, i) => ({ i, rest: e - Math.floor(e) })).sort((a, b) => b.rest - a.rest || b.i - a.i);
  for (let k = 0; sizes.reduce((s, n) => s + n, 0) < count; k++) sizes[order[k % order.length].i]++;
  const out: Planet[] = [];
  sizes.forEach((n, ring) => {
    // Each ring starts a little turned against the last, so the planets don't line up.
    const offset = ring * 0.9;
    for (let k = 0; k < n; k++) out.push({ ring, phase: offset + (k / n) * Math.PI * 2 });
  });
  return out;
}

export interface PlanetPose {
  x: number;
  y: number;
  /** -1 at the very back of the orbit, +1 at the very front. */
  depth: number;
  scale: number;
  opacity: number;
}

/** Where a planet is `t` seconds in. */
export function planetAt(p: Planet, t: number, rings: readonly Ring[] = RINGS): PlanetPose {
  const r = rings[p.ring];
  const a = p.phase + r.speed * t;
  const depth = Math.sin(a);
  return {
    x: r.rx * Math.cos(a),
    y: r.ry * depth,
    depth,
    scale: 0.9 + 0.22 * depth,
    opacity: 0.72 + 0.28 * (depth + 1) / 2,
  };
}
