import { describe, expect, it } from 'vitest';
import { BRIDGE_HEIGHT, SHAPES, WALL, crossings, generateTrack, pointAt, project, validTrack } from '../client/src/games/rally/track';
import { DT, ITUNING, LAPS, RallySim, itemWeights, racePoints, rollItem, type Car } from '../client/src/games/rally/sim';
import { gameInfo, playerCountProblem } from '../shared/protocol';
import { mulberry32 } from '../client/src/games/rng';

describe('generateTrack', () => {
  it('builds valid closed loops of every shape', () => {
    for (const shape of SHAPES) {
      for (let seed = 1; seed <= 12; seed++) {
        const t = generateTrack(seed * 101, shape);
        expect(t.shape).toBe(shape);
        expect(validTrack(t.xs, t.zs, !!t.crossing)).toBe(true);
        expect(t.length).toBeGreaterThan(900);
        expect(t.length).toBeLessThan(1500);
        const end = Math.hypot(t.xs[t.n - 1] - t.xs[0], t.zs[t.n - 1] - t.zs[0]);
        expect(end).toBeLessThan(3);
        expect(t.town).not.toBeNull();
      }
    }
  });
  it('gives figure eights one crossing with a bridge over it', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const t = generateTrack(seed, 'figure8');
      expect(crossings(t.xs, t.zs)).toHaveLength(1);
      const { over, under } = t.crossing!;
      expect(t.hs[over] - t.hs[under]).toBeGreaterThanOrEqual(BRIDGE_HEIGHT - 0.01);
      expect(t.bridge[over]).toBe(1);
      expect(t.bridge[under]).toBe(0);
      // Starts on the ground.
      expect(t.bridge[0]).toBe(0);
    }
  });
  it('has no crossings on other shapes', () => {
    for (const shape of SHAPES.filter((s) => s !== 'figure8')) expect(generateTrack(3, shape).crossing).toBeNull();
  });
  it('is deterministic', () => {
    const a = generateTrack(42);
    const b = generateTrack(42);
    expect([...a.xs]).toEqual([...b.xs]);
    expect(a.shape).toBe(b.shape);
  });
});

describe('project', () => {
  const t = generateTrack(7, 'ring');
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
function drive(sim: RallySim, seconds: number, each?: (c: Car) => void) {
  for (let k = 0; k < seconds / DT; k++) {
    for (const c of sim.cars) {
      if (c.finished) continue;
      const ahead = pointAt(sim.track, c.along + 12, 0);
      let d = Math.atan2(ahead.z - c.z, ahead.x - c.x) - c.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      c.input = { x: Math.max(-100, Math.min(100, d * 200)), y: -100 };
      each?.(c);
    }
    sim.step();
  }
}

describe('RallySim', () => {
  it('lets cars drive three laps on every shape, over and under the bridge', () => {
    for (const shape of SHAPES) {
      const sim = new RallySim(generateTrack(3, shape), 2, LAPS, false);
      let maxH = -Infinity;
      drive(sim, 300, (c) => (maxH = Math.max(maxH, c.h)));
      for (const c of sim.cars) expect(c.finished, shape).toBe(true);
      const lapTime = sim.cars[0].finishTime! / LAPS;
      expect(lapTime).toBeGreaterThan(20);
      expect(lapTime).toBeLessThan(60);
      if (shape === 'figure8') expect(maxH).toBeGreaterThan(sim.track.hs[sim.track.crossing!.under] + BRIDGE_HEIGHT - 1);
    }
  });
  it('keeps cars inside the barriers', () => {
    const sim = new RallySim(generateTrack(11), 1, LAPS, false);
    const c = sim.cars[0];
    for (let k = 0; k < 900; k++) {
      c.input = { x: 100, y: -100 };
      sim.step();
      expect(Math.abs(c.lateral)).toBeLessThanOrEqual(WALL + 0.01);
    }
  });
  it('does not count laps for driving backwards over the line', () => {
    const sim = new RallySim(generateTrack(5), 1, LAPS, false);
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
    expect([1, 2, 3, 4, 5].map(racePoints)).toEqual([15, 12, 10, 8, 6]);
  });
});

/** Put car `c` at distance `d` along the track (and `lateral` to the left), facing forward. */
function place(sim: RallySim, c: Car, d: number, lateral = 0, speed = 0) {
  const p = pointAt(sim.track, d, lateral);
  const pr = project(sim.track, p.x, p.z);
  Object.assign(c, { x: p.x, z: p.z, h: pr.h, heading: p.heading, hint: pr.i, along: pr.along, lateral: pr.lateral, progress: d, speed });
}

describe('items', () => {
  const track = generateTrack(21, 'speedway');
  it('puts rows of boxes on the track and hands out an item when you drive through one', () => {
    const sim = new RallySim(track, 1, LAPS, true, mulberry32(1));
    expect(sim.boxes).toHaveLength(ITUNING.boxRows.length * ITUNING.boxLanes.length);
    const c = sim.cars[0];
    place(sim, c, track.length * ITUNING.boxRows[0] - 10, 1.5, 30);
    let got = null as string | null;
    for (let k = 0; k < 60 && !got; k++) {
      c.input = { x: 0, y: -100 };
      got = sim.step().pickups[0]?.item ?? null;
    }
    expect(got).not.toBeNull();
    expect(c.item).toBe(got);
    // Holding an item: no second pickup.
    expect(sim.boxes.filter((b) => b.back > sim.time)).toHaveLength(1);
  });
  it('makes no items when they are switched off', () => {
    expect(new RallySim(track, 2, LAPS, false).boxes).toHaveLength(0);
  });
  it('boosts', () => {
    const sim = new RallySim(track, 1, LAPS, false);
    const c = sim.cars[0];
    place(sim, c, 100, 0, 30);
    c.item = 'boost';
    expect(sim.useItem(0)).toBe(true);
    expect(c.item).toBeNull();
    for (let k = 0; k < 60; k++) sim.step();
    expect(c.speed).toBeGreaterThan(48);
    expect(sim.useItem(0)).toBe(false);
  });
  it('drops butter that spins the next car over it', () => {
    const sim = new RallySim(track, 2, LAPS, false);
    const [a, b] = sim.cars;
    place(sim, a, 200, 0, 0);
    place(sim, b, 170, 0, 25);
    a.item = 'butter';
    sim.useItem(0);
    place(sim, a, 500, 0, 0);
    let spun = false;
    for (let k = 0; k < 120; k++) {
      const ahead = pointAt(sim.track, b.along + 8, 0);
      const d = Math.atan2(ahead.z - b.z, ahead.x - b.x) - b.heading;
      b.input = { x: Math.max(-100, Math.min(100, Math.atan2(Math.sin(d), Math.cos(d)) * 200)), y: -100 };
      const ev = sim.step();
      if (ev.hits.some((h) => h.idx === 1 && h.kind === 'butter' && !h.blocked)) spun = b.spin > 0;
    }
    expect(spun).toBe(true);
    expect(sim.slicks).toHaveLength(0);
  });
  it('fires a pickle at the car in front, and a pot lid blocks it', () => {
    for (const shielded of [false, true]) {
      const sim = new RallySim(track, 3, LAPS, false);
      const [a, b, far] = sim.cars;
      place(sim, a, 100, 0, 0);
      place(sim, b, 160, 4, 0);
      place(sim, far, 400, 0, 0);
      if (shielded) b.shield = 10;
      a.item = 'pickle';
      sim.useItem(0);
      expect(sim.pickles[0].target).toBe(1);
      const hits = [];
      for (let k = 0; k < 120; k++) hits.push(...sim.step().hits);
      expect(hits).toEqual([{ idx: 1, by: 0, kind: 'pickle', blocked: shielded }]);
      expect(b.shield).toBe(0);
    }
  });
  it('sends a thunderstorm to everyone ahead only', () => {
    const sim = new RallySim(track, 3, LAPS, false);
    const [a, b, c] = sim.cars;
    place(sim, a, 300);
    place(sim, b, 200);
    place(sim, c, 100);
    c.item = 'storm';
    sim.useItem(2);
    expect(a.slow).toBeGreaterThan(0);
    expect(b.slow).toBeGreaterThan(0);
    expect(c.slow).toBe(0);
  });
  it('makes a rocket fast and immune, then hands control back', () => {
    const sim = new RallySim(track, 2, LAPS, false);
    const [a, b] = sim.cars;
    place(sim, a, 100, 0, 20);
    place(sim, b, 300);
    a.input = { x: 37, y: -40 };
    a.item = 'rocket';
    sim.useItem(0);
    b.item = 'storm';
    sim.useItem(1);
    expect(a.slow).toBe(0);
    let top = 0;
    for (let k = 0; k < 150; k++) {
      sim.step();
      top = Math.max(top, a.speed);
      expect(Math.abs(a.lateral)).toBeLessThan(WALL);
    }
    expect(top).toBeGreaterThan(55);
    expect(a.input).toEqual({ x: 37, y: -40 });
  });
  it('gives leaders defence and the back of the field catch-up items', () => {
    const lead = itemWeights(0, 4);
    const last = itemWeights(1, 4);
    expect(lead.rocket).toBe(0);
    expect(lead.storm).toBe(0);
    expect(last.rocket).toBeGreaterThan(0);
    expect(last.boost).toBeGreaterThan(lead.boost);
    const rng = mulberry32(3);
    const seen = new Set(Array.from({ length: 400 }, () => rollItem(Math.random(), 4, rng)));
    expect(seen.size).toBe(6);
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
