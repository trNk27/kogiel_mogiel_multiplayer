import { describe, expect, it } from 'vitest';
import { WALL, generateTrack, pointAt, project, validTrack } from '../client/src/games/rally/track';
import { DT, LAPS, RallySim, racePoints } from '../client/src/games/rally/sim';
import { gameInfo, playerCountProblem } from '../shared/protocol';

describe('generateTrack', () => {
  it('always builds a valid closed loop of sensible length', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const t = generateTrack(seed);
      expect(validTrack(t.xs, t.zs)).toBe(true);
      expect(t.length).toBeGreaterThan(700);
      expect(t.length).toBeLessThan(1600);
      const end = Math.hypot(t.xs[t.n - 1] - t.xs[0], t.zs[t.n - 1] - t.zs[0]);
      expect(end).toBeLessThan(3);
      expect(Math.abs(t.hs[0])).toBeLessThan(0.5);
    }
  });
  it('is deterministic', () => {
    const a = generateTrack(42);
    const b = generateTrack(42);
    expect([...a.xs]).toEqual([...b.xs]);
    expect(generateTrack(43).length).not.toBe(a.length);
  });
});

describe('project', () => {
  const t = generateTrack(7);
  it('finds the distance along the track and the side of the road', () => {
    for (const d of [0, 100, 333.3, t.length - 5]) {
      const left = pointAt(t, d, 4);
      const p = project(t, left.x, left.z);
      const off = Math.abs(p.along - d);
      expect(Math.min(off, t.length - off)).toBeLessThan(0.5);
      expect(p.lateral).toBeCloseTo(4, 0);
      const right = pointAt(t, d, -5);
      expect(project(t, right.x, right.z, p.i).lateral).toBeCloseTo(-5, 0);
    }
  });
});

/** Steer towards a point a little way ahead, full gas. */
function drive(sim: RallySim, seconds: number) {
  for (let k = 0; k < seconds / DT; k++) {
    for (const c of sim.cars) {
      if (c.finished) continue;
      const ahead = pointAt(sim.track, c.along + 12, 0);
      let d = Math.atan2(ahead.z - c.z, ahead.x - c.x) - c.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      c.input = { x: Math.max(-100, Math.min(100, d * 200)), y: -100 };
    }
    sim.step();
  }
}

describe('RallySim', () => {
  it('lets a car drive three laps and finish', () => {
    const sim = new RallySim(generateTrack(3), 2);
    drive(sim, 240);
    for (const c of sim.cars) {
      expect(c.finished).toBe(true);
      expect(c.progress).toBeGreaterThanOrEqual(LAPS * sim.track.length);
    }
    const lapTime = sim.cars[0].finishTime! / LAPS;
    expect(lapTime).toBeGreaterThan(15);
    expect(lapTime).toBeLessThan(60);
  });
  it('keeps cars inside the barriers', () => {
    const sim = new RallySim(generateTrack(11), 1);
    const c = sim.cars[0];
    for (let k = 0; k < 900; k++) {
      c.input = { x: 100, y: -100 };
      sim.step();
      expect(Math.abs(c.lateral)).toBeLessThanOrEqual(WALL + 0.01);
    }
  });
  it('does not count laps for driving backwards over the line', () => {
    const sim = new RallySim(generateTrack(5), 1);
    const c = sim.cars[0];
    c.heading += Math.PI;
    for (let k = 0; k < 600; k++) {
      c.input = { x: 0, y: -100 };
      sim.step();
    }
    expect(c.progress).toBeLessThan(0);
    expect(c.finished).toBe(false);
  });
  it('orders finishers by time and the rest by distance', () => {
    const sim = new RallySim(generateTrack(9), 3);
    sim.cars[0].progress = 10;
    sim.cars[1].progress = 50;
    sim.cars[2].finished = true;
    sim.cars[2].finishTime = 99;
    expect(sim.order()).toEqual([2, 1, 0]);
  });
  it('awards cup points by place', () => {
    expect([1, 2, 3, 8, 9].map(racePoints)).toEqual([15, 12, 10, 1, 0]);
  });
});

describe('player limit', () => {
  it('takes 1 to 4 players', () => {
    const info = gameInfo('rally');
    expect(playerCountProblem(info, 1, 1)).toBeNull();
    expect(playerCountProblem(info, 4, 4)).toBeNull();
    expect(playerCountProblem(info, 4, 5)).toMatch(/up to 4/);
    expect(playerCountProblem(gameInfo('quiz'), 8, 8)).toBeNull();
  });
});
