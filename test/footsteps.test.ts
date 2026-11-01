import { describe, expect, it } from 'vitest';
import {
  ARENA_R,
  DOT_GAP,
  DT,
  END_PAUSE,
  FADE_S,
  FootstepsSim,
  HOLD_S,
  SHAPES,
  SHAPE_R,
  START_PAUSE,
  WALK,
  WATCH_X,
  WATCH_Z,
  accuracy,
  buildShape,
  cumulative,
  difficultyFor,
  distToLine,
  howTo,
  makeShape,
  pointAt,
  resample,
  type Difficulty,
  type FootEvent,
  type FootInput,
} from '../client/src/games/footsteps/logic';
import { mulberry32 } from '../client/src/games/rng';

function run(sim: FootstepsSim, seconds: number, input: (i: number) => FootInput | undefined = () => undefined) {
  const all: FootEvent[] = [];
  const steps = Math.round(seconds / DT);
  for (let k = 0; k < steps; k++) all.push(...sim.step(sim.players.map((_, i) => input(i))));
  return all;
}

/** Steer player i along the shape like a perfect copycat: always head for a point a little ahead on the trail. */
function follower(sim: FootstepsSim, i: number, offset = 0) {
  let along = 0;
  return (): FootInput => {
    const p = sim.players[i];
    // Move the target along the trail as we catch up with it.
    for (;;) {
      const t = pointAt(sim.shape, along);
      const tx = t.x - t.fz * offset;
      const tz = t.z + t.fx * offset;
      if (Math.hypot(tx - p.x, tz - p.z) > 0.6 || along >= sim.shape.len) break;
      along += 0.2;
    }
    const t = pointAt(sim.shape, along);
    const tx = t.x - t.fz * offset;
    const tz = t.z + t.fx * offset;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (along >= sim.shape.len && d < 0.15) return { x: 0, z: 0, done: true };
    const s = Math.min(1, d / 0.3);
    return d > 1e-6 ? { x: (dx / d) * s, z: (dz / d) * s } : { x: 0, z: 0 };
  };
}

describe('Śladami Babci shapes', () => {
  it('every shape fits on the clearing, for many random rolls', () => {
    const rng = mulberry32(3);
    for (let d = 0 as Difficulty; d <= 2; d = (d + 1) as Difficulty)
      for (const t of SHAPES[d])
        for (let k = 0; k < 30; k++) {
          const s = buildShape(t, d, rng);
          for (let j = 0; j < s.pts.length; j += 2) expect(Math.hypot(s.pts[j], s.pts[j + 1])).toBeLessThan(ARENA_R - 1.5);
          expect(s.len).toBeGreaterThan(18);
          expect(s.len).toBeLessThan(60);
          expect(s.cum.length).toBe(s.pts.length / 2);
        }
  });

  it('closed shapes end where they start', () => {
    const rng = mulberry32(8);
    for (const t of SHAPES.flat().filter((x) => x.closed)) {
      const s = buildShape(t, 1, rng);
      expect(Math.hypot(s.pts[0] - s.pts[s.pts.length - 2], s.pts[1] - s.pts[s.pts.length - 1])).toBeLessThan(1e-9);
    }
  });

  it('makeShape avoids shapes already walked', () => {
    const names = SHAPES[0].map((t) => t.name);
    for (let k = 0; k < 20; k++) {
      const s = makeShape(0, mulberry32(k), names.slice(1));
      expect(s.name).toBe(names[0]);
    }
    // All used up: any shape will do.
    expect(names).toContain(makeShape(0, mulberry32(1), names).name);
  });

  it('the shapes are scaled up to near the clearing size', () => {
    const rng = mulberry32(4);
    for (const t of SHAPES.flat()) {
      const s = buildShape(t, 2, rng);
      const xs = s.pts.filter((_, k) => k % 2 === 0);
      const zs = s.pts.filter((_, k) => k % 2 === 1);
      const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      expect(size).toBeGreaterThan(SHAPE_R);
    }
  });
});

describe('Śladami Babci geometry', () => {
  it('cumulative and pointAt walk along a polyline', () => {
    const pts = [0, 0, 3, 0, 3, 4];
    expect(cumulative(pts)).toEqual([0, 3, 7]);
    const shape = { name: 'L', pts, closed: false, cum: [0, 3, 7], len: 7 };
    expect(pointAt(shape, 1.5)).toMatchObject({ x: 1.5, z: 0, fx: 1, fz: 0 });
    expect(pointAt(shape, 5)).toMatchObject({ x: 3, z: 2, fx: 0, fz: 1 });
    expect(pointAt(shape, 99)).toMatchObject({ x: 3, z: 4 });
  });

  it('resample spaces points evenly and keeps both ends', () => {
    const r = resample([0, 0, 1, 0, 1, 1], 0.25);
    expect(r.slice(0, 2)).toEqual([0, 0]);
    expect(r.slice(-2)).toEqual([1, 1]);
    expect(r.length / 2).toBe(9);
    for (let k = 2; k < r.length; k += 2) expect(Math.hypot(r[k] - r[k - 2], r[k + 1] - r[k - 1])).toBeCloseTo(0.25, 5);
  });

  it('distToLine measures to the nearest segment', () => {
    expect(distToLine(1, 2, [0, 0, 4, 0])).toBeCloseTo(2);
    expect(distToLine(-3, 4, [0, 0, 4, 0])).toBeCloseTo(5);
    expect(distToLine(1, 1, [0, 0])).toBeCloseTo(Math.SQRT2);
  });
});

describe('Śladami Babci accuracy', () => {
  const square = [0, 0, 6, 0, 6, 6, 0, 6, 0, 0];

  it('a perfect copy is 100 %, nothing at all is 0 %', () => {
    expect(accuracy(square, square)).toBe(100);
    expect(accuracy(square, [])).toBe(0);
    expect(accuracy(square, [1, 1])).toBe(0);
  });

  it('a copy walked the other way round counts the same', () => {
    expect(accuracy(square, [...square].reverse().flatMap((_, k, a) => (k % 2 ? [] : [a[k + 1], a[k]])))).toBe(100);
  });

  it('the further off, the lower', () => {
    const shifted = (d: number) => square.map((v, k) => (k % 2 ? v : v + d));
    const a = [0.3, 0.8, 1.6, 3, 6].map((d) => accuracy(square, shifted(d)));
    for (let k = 1; k < a.length; k++) expect(a[k]).toBeLessThan(a[k - 1]);
    expect(a[0]).toBeGreaterThan(90);
    expect(a[a.length - 1]).toBeLessThan(25);
  });

  it('stopping halfway costs, and so does wandering on past the end', () => {
    const half = [0, 0, 6, 0, 6, 6];
    const wander = [...square, -6, 0, -6, -6];
    expect(accuracy(square, half)).toBeLessThan(60);
    expect(accuracy(square, wander)).toBeLessThan(70);
    expect(accuracy(square, half)).toBeGreaterThan(20);
  });
});

describe('Śladami Babci round', () => {
  const tri = () => buildShape(SHAPES[0][0], 0, mulberry32(2));

  it('Babcia waits, walks the whole trail, then lets everyone go', () => {
    const shape = tri();
    const sim = new FootstepsSim(2, { shape });
    expect(sim.phase).toBe('show');
    expect(sim.showS).toBeCloseTo(START_PAUSE + shape.len / sim.speed + END_PAUSE, 6);
    run(sim, START_PAUSE * 0.9);
    expect(sim.laid).toBe(0);
    const ev = run(sim, 1);
    expect(ev.some((e) => e.t === 'walk')).toBe(true);
    expect(sim.bwalk).toBe(true);
    expect(sim.laid).toBeGreaterThan(0);
    expect(sim.trailShown()).toBe(1);
    const ev2 = run(sim, sim.showS);
    expect(ev2.filter((e) => e.t === 'go')).toHaveLength(1);
    expect(sim.phase).toBe('trace');
    expect(sim.laid).toBe(shape.len);
  });

  it('nobody moves while Babcia walks', () => {
    const sim = new FootstepsSim(1, { shape: tri() });
    const x0 = sim.players[0].x;
    run(sim, sim.showS - 0.1, () => ({ x: 1, z: 0 }));
    expect(sim.players[0].x).toBe(x0);
    expect(sim.players[0].trail).toHaveLength(0);
  });

  it('her trail stays for a moment, then fades, while you can already walk', () => {
    const sim = new FootstepsSim(1, { shape: tri(), difficulty: 0 });
    run(sim, sim.showS + DT);
    expect(sim.phase).toBe('trace');
    const ev = run(sim, HOLD_S[0] - 0.1, () => ({ x: 1, z: 0 }));
    expect(sim.trailShown()).toBe(1);
    expect(sim.players[0].trail.length).toBeGreaterThan(4);
    expect(ev.some((e) => e.t === 'fade')).toBe(false);
    const ev2 = run(sim, 0.3);
    expect(ev2.some((e) => e.t === 'fade')).toBe(true);
    expect(sim.trailShown()).toBeGreaterThan(0);
    expect(sim.trailShown()).toBeLessThan(1);
    const ev3 = run(sim, FADE_S);
    expect(ev3.some((e) => e.t === 'gone')).toBe(true);
    expect(sim.trailShown()).toBe(0);
  });

  it('footprints are recorded every DOT_GAP from where you stood', () => {
    const sim = new FootstepsSim(1, { shape: tri() });
    run(sim, sim.showS + DT);
    const { x, z } = sim.players[0];
    run(sim, 1, () => ({ x: 1, z: 0 }));
    const t = sim.players[0].trail;
    expect(t[0]).toBeCloseTo(x);
    expect(t[1]).toBeCloseTo(z);
    for (let k = 2; k < t.length; k += 2) expect(Math.hypot(t[k] - t[k - 2], t[k + 1] - t[k - 1])).toBeGreaterThanOrEqual(DOT_GAP - 1e-9);
    // About WALK metres in a second (a little less for speeding up).
    expect(sim.players[0].x - x).toBeGreaterThan(WALK * 0.85);
  });

  it('you can’t walk off the clearing', () => {
    const sim = new FootstepsSim(1, { shape: tri() });
    run(sim, sim.showS + DT);
    run(sim, 8, () => ({ x: 1, z: 0 }));
    const p = sim.players[0];
    expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(ARENA_R);
  });

  it('a good copycat scores high and someone who wanders off scores low', () => {
    const sim = new FootstepsSim(2, { shape: tri() });
    run(sim, sim.showS + DT);
    const good = follower(sim, 0);
    // The other one just strolls off in a straight line.
    const ev = run(sim, sim.traceS + 1, (i) => (i === 0 ? good() : { x: 0.6, z: 0.2 }));
    expect(ev.some((e) => e.t === 'end')).toBe(true);
    expect(sim.phase).toBe('end');
    expect(sim.players[0].acc).toBeGreaterThan(85);
    expect(sim.players[1].acc).toBeLessThan(30);
    expect(sim.ranking()).toEqual([0, 1]);
  });

  it('everyone saying Done ends the walk early', () => {
    const sim = new FootstepsSim(2, { shape: tri() });
    run(sim, sim.showS + DT);
    run(sim, 0.5, () => ({ x: 0, z: -1 }));
    // Done before taking a step does nothing.
    const sim2 = new FootstepsSim(1, { shape: tri() });
    run(sim2, sim2.showS + DT);
    run(sim2, 0.1, () => ({ x: 0, z: 0, done: true }));
    expect(sim2.players[0].done).toBe(false);

    const ev = run(sim, DT, (i) => ({ x: 0, z: 0, done: i === 0 }));
    expect(ev.filter((e) => e.t === 'done')).toEqual([{ t: 'done', p: 0 }]);
    expect(sim.phase).toBe('trace');
    // Done players stand still.
    const p0 = { ...sim.players[0] };
    run(sim, 0.5, () => ({ x: 1, z: 0 }));
    expect(sim.players[0].x).toBe(p0.x);
    expect(sim.players[0].trail.length).toBe(p0.trail.length);
    run(sim, DT, () => ({ x: 0, z: 0, done: true }));
    expect(sim.phase).toBe('end');
    expect(sim.left).toBeGreaterThan(5);
    for (const p of sim.players) expect(p.acc).toBeGreaterThanOrEqual(0);
  });

  it('the clock ends the walk for those who never said Done', () => {
    const sim = new FootstepsSim(1, { shape: tri() });
    run(sim, sim.showS + DT);
    run(sim, sim.traceS - 0.05);
    expect(sim.phase).toBe('trace');
    run(sim, 0.1);
    expect(sim.phase).toBe('end');
    expect(sim.players[0].acc).toBe(0);
  });

  it('Babcia steps off to watch once you’re let go', () => {
    const sim = new FootstepsSim(1, { shape: tri() });
    run(sim, sim.showS + DT);
    run(sim, 8);
    expect(sim.bx).toBe(WATCH_X);
    expect(sim.bz).toBe(WATCH_Z);
    expect(Math.hypot(sim.bx, sim.bz)).toBeLessThan(ARENA_R);
    expect(sim.bwalk).toBe(false);
  });

  it('a player who leaves scores nothing, and the rest finishing ends it', () => {
    const sim = new FootstepsSim(2, { shape: tri() });
    run(sim, sim.showS + DT);
    run(sim, 0.5, () => ({ x: 1, z: 0 }));
    run(sim, DT, (i) => (i === 0 ? { x: 0, z: 0, done: true } : undefined));
    expect(sim.phase).toBe('trace');
    sim.remove(1);
    expect(sim.phase).toBe('end');
    expect(sim.scores()[1]).toBe(0);
    expect(sim.ranking()).toEqual([0]);
  });

  it('walking time grows with the trail', () => {
    const easy = new FootstepsSim(1, { shape: buildShape(SHAPES[0][0], 0, mulberry32(1)) });
    const hard = new FootstepsSim(1, { difficulty: 2, shape: buildShape(SHAPES[2][0], 2, mulberry32(1)) });
    expect(hard.traceS).toBeGreaterThan(easy.traceS);
    expect(easy.traceS).toBeGreaterThan(easy.shape.len / WALK + 3);
    expect(hard.holdS).toBeLessThan(easy.holdS);
  });
});

describe('Śladami Babci rounds', () => {
  it('three rounds get harder; a tournament plays one medium one', () => {
    expect([1, 2, 3].map((r) => difficultyFor(r, 3))).toEqual([0, 1, 2]);
    expect(difficultyFor(1, 1)).toBe(1);
  });

  it('has a three-line how-to', () => {
    expect(howTo(false)).toHaveLength(3);
    expect(howTo(true)).toHaveLength(3);
  });
});
