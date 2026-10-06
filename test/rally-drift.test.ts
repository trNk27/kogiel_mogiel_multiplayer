import { describe, expect, it } from 'vitest';
import { ALL_SHAPES, HARD_SHAPES, HARD_WALL, SHAPES, SHAPE_NAMES, WALL, cupShapes, generateTrack, pointAt, project, validTrack } from '../client/src/games/rally/track';
import { DRIFT, DT, LAPS, RallySim, driftCode, driftLevel, setDriftLook, type Car } from '../client/src/games/rally/sim';
import { RALLY_TRACKS, rallyTrack } from '../shared/protocol';
import { shuffle } from '../client/src/games/quiz/logic';

/** Tightest corner (radius in m, measured like the validity check) on a track. */
function tightest(t: { xs: Float64Array; zs: Float64Array; n: number }) {
  let m = Infinity;
  const W = 3;
  const { n, xs: x, zs: z } = t;
  for (let i = 0; i < n; i++) {
    const a = (i - W + n) % n;
    const c = (i + W) % n;
    let turn = Math.abs(Math.atan2(z[c] - z[(c - 1 + n) % n], x[c] - x[(c - 1 + n) % n]) - Math.atan2(z[(a + 1) % n] - z[a], x[(a + 1) % n] - x[a]));
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > 1e-6) m = Math.min(m, 10 / turn);
  }
  return m;
}

describe('hard tracks', () => {
  it('builds valid hard tracks with much tighter corners and narrow barriers', () => {
    for (const shape of HARD_SHAPES) {
      for (let seed = 1; seed <= 6; seed++) {
        const t = generateTrack(seed * 53, shape);
        expect(t.shape).toBe(shape);
        expect(t.hard).toBe(true);
        expect(validTrack(t.xs, t.zs, false, true)).toBe(true);
        expect(tightest(t)).toBeLessThan(16);
        expect(t.wall[0]).toBe(HARD_WALL);
        expect(Math.max(...t.wall)).toBeLessThanOrEqual(HARD_WALL);
        expect(t.length).toBeGreaterThan(800);
      }
    }
  });
  it('keeps normal tracks as they were', () => {
    for (const shape of SHAPES) {
      const t = generateTrack(17, shape);
      expect(t.hard).toBe(false);
      expect(t.wall[0]).toBe(WALL);
      expect(tightest(t)).toBeGreaterThanOrEqual(17.9);
    }
  });
  it('can be driven: three laps of each hard track', () => {
    for (const shape of HARD_SHAPES) {
      const sim = new RallySim(generateTrack(9, shape), 1, LAPS, false);
      const c = sim.cars[0];
      for (let k = 0; k < 400 / DT && !c.finished; k++) {
        c.input = sim.autopilot(c, 22);
        sim.step();
        expect(Math.abs(c.lateral)).toBeLessThanOrEqual(sim.track.wall[c.hint] + 0.01);
      }
      expect(c.finished, shape).toBe(true);
    }
  });
  it('offers a mixed cup, a hard cup and every single track', () => {
    expect(RALLY_TRACKS.filter((t) => !t.cup).map((t) => t.id)).toEqual([...ALL_SHAPES]);
    for (const s of ALL_SHAPES) expect(SHAPE_NAMES[s]).toBe(rallyTrack(s).name);
    expect(cupShapes('cup', 3, shuffle).every((s) => (SHAPES as readonly string[]).includes(s))).toBe(true);
    expect(new Set(cupShapes('hard', 3, shuffle))).toEqual(new Set(HARD_SHAPES));
    expect(cupShapes('pass', 3, shuffle)).toEqual(['pass', 'pass', 'pass']);
    expect(cupShapes('nonsense', 3, shuffle)).toHaveLength(6);
  });
});

/** Put car `c` at distance `d` along the track, facing forward, at `speed`. */
function place(sim: RallySim, c: Car, d: number, speed: number) {
  const p = pointAt(sim.track, d, 0);
  const pr = project(sim.track, p.x, p.z);
  Object.assign(c, { x: p.x, z: p.z, h: pr.h, heading: p.heading, hint: pr.i, along: pr.along, lateral: 0, progress: d, speed });
}

/** Turn at full lock on the spot (kept in the middle of the road) and measure how far the car turns. */
function circle(drift: boolean, seconds = 1.5) {
  const sim = new RallySim(generateTrack(21, 'speedway'), 1, LAPS, false);
  const c = sim.cars[0];
  place(sim, c, 100, 38);
  const start = c.heading;
  const spot = pointAt(sim.track, 100, 0);
  for (let k = 0; k < seconds / DT; k++) {
    c.input = { x: 100, y: drift ? 100 : -100 };
    // Stay in the middle of the road, so the barriers never get in the way.
    c.x = spot.x;
    c.z = spot.z;
    sim.step();
  }
  return { turned: c.heading - start, c, sim };
}

describe('drifting', () => {
  it('turns much tighter than grip allows, nose into the corner', () => {
    const grip = circle(false, 1);
    const slide = circle(true, 1);
    expect(slide.turned).toBeGreaterThan(grip.turned * 1.6);
    expect(slide.c.drift).toBe(1);
    expect(slide.c.slip).toBeGreaterThan(DRIFT.slip * 0.8);
    // The brake doesn't slow you down while it's drifting.
    expect(slide.c.speed).toBeGreaterThan(25);
  });

  it('builds sparks and gives a turbo when you let go', () => {
    const { c, sim } = circle(true, DRIFT.super / 1.2 + 0.2);
    expect(driftLevel(c)).toBe(2);
    expect(driftCode(c)).toBe(3);
    c.input = { x: 0, y: -100 };
    const ev = sim.step();
    expect(ev.turbos).toEqual([{ idx: 0, level: 2 }]);
    expect(c.boost).toBeGreaterThan(1);
    expect(c.drift).toBe(0);
  });

  it('gives nothing for a short drift, and needs speed and steering to start', () => {
    const short = circle(true, 0.3);
    expect(driftLevel(short.c)).toBe(0);
    short.c.input = { x: 0, y: -100 };
    expect(short.sim.step().turbos).toEqual([]);
    expect(short.c.boost).toBe(0);

    const sim = new RallySim(generateTrack(21, 'speedway'), 1, LAPS, false);
    const c = sim.cars[0];
    // Braking in a straight line just brakes.
    place(sim, c, 100, 30);
    c.input = { x: 0, y: 100 };
    for (let k = 0; k < 30; k++) sim.step();
    expect(c.drift).toBe(0);
    expect(c.speed).toBeLessThan(15);
    place(sim, c, 100, 5);
    c.input = { x: 100, y: 100 };
    sim.step();
    expect(c.drift).toBe(0);
  });

  it('loses the drift (and the turbo) when you spin out', () => {
    const { c, sim } = circle(true, 1.2);
    expect(driftLevel(c)).toBe(1);
    c.spin = 1;
    const ev = sim.step();
    expect(ev.turbos).toEqual([]);
    expect(c.drift).toBe(0);
  });

  it('shows other phones’ drifts from the network code', () => {
    const { c } = circle(true, 1.2);
    const other = circle(false, 0.1).c;
    setDriftLook(other, driftCode(c));
    expect(driftLevel(other)).toBe(driftLevel(c));
    setDriftLook(other, 0);
    expect(other.drift).toBe(0);
  });
});
