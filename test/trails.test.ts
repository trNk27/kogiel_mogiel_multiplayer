import { describe, expect, it } from 'vitest';
import { Grid, POWER_KINDS, POWER_TUNING, TICK_HZ, TrailsSim, TUNING, mulberry32, type TrailsTuning } from '../client/src/games/trails/sim';
import { awardDeaths, trailsTarget, trailsWinner } from '../client/src/games/trails/scoring';

/** A tuning without gaps or ghost phase, so tests are about collisions only. */
const SOLID: TrailsTuning = { ...TUNING, gapMin: 1e6, gapMax: 1e6, ghostTime: 0 };

function place(sim: TrailsSim, idx: number, x: number, y: number, angle: number) {
  const s = sim.snakes[idx];
  s.x = x;
  s.y = y;
  s.angle = angle;
  s.ghostTicks = 0;
}

function run(sim: TrailsSim, ticks: number) {
  const deaths: number[] = [];
  for (let i = 0; i < ticks; i++) deaths.push(...sim.step().deaths);
  return deaths;
}

describe('Grid', () => {
  it('paints a disc and detects other owners', () => {
    const grid = new Grid(50, 50);
    grid.paint(25, 25, 3, 1, 10);
    expect(grid.hits(25, 25, 2, 11, 5)).toBe(true);
    expect(grid.hits(25, 27.5, 2, 11, 5)).toBe(true);
    expect(grid.hits(25, 30, 2, 11, 5)).toBe(false);
  });
  it('ignores your own fresh trail but not your old one', () => {
    const grid = new Grid(50, 50);
    grid.paint(10, 10, 2, 1, 100);
    expect(grid.hits(10, 10, 1, 103, 5)).toBe(false);
    expect(grid.hits(10, 10, 1, 106, 5)).toBe(true);
  });
  it('treats outside the grid as solid unless wrapping', () => {
    const grid = new Grid(20, 20);
    expect(grid.hits(-1, 5, 1, 0, 5)).toBe(true);
    expect(grid.hits(-1, 5, 1, 0, 5, true)).toBe(false);
    grid.paint(19.5, 5, 2, 2, 0, true);
    expect(grid.hits(0.2, 5, 1, 0, 5, true)).toBe(true);
  });
});

describe('TrailsSim collisions', () => {
  it('a line going straight survives in open space', () => {
    const sim = new TrailsSim(1, { rng: mulberry32(1), tuning: SOLID });
    place(sim, 0, 100, 240, 0);
    expect(run(sim, 3 * TICK_HZ)).toEqual([]);
    expect(sim.snakes[0].alive).toBe(true);
  });

  it('hitting the wall kills', () => {
    const sim = new TrailsSim(1, { rng: mulberry32(1), tuning: SOLID });
    place(sim, 0, 760, 240, 0);
    const deaths = run(sim, 2 * TICK_HZ);
    expect(deaths).toEqual([0]);
    expect(sim.snakes[0].x).toBeLessThanOrEqual(800);
  });

  it('crossing another trail kills', () => {
    const sim = new TrailsSim(2, { rng: mulberry32(2), tuning: SOLID });
    // 0 draws a horizontal wall, 1 drives into it from below.
    place(sim, 0, 300, 240, 0);
    place(sim, 1, 400, 400, -Math.PI / 2); // heading up (negative y)
    const deaths = run(sim, 4 * TICK_HZ);
    expect(deaths).toContain(1);
    expect(sim.snakes[0].alive).toBe(true);
  });

  it('turning in a circle eventually hits your own trail', () => {
    const sim = new TrailsSim(1, { rng: mulberry32(3), tuning: SOLID });
    place(sim, 0, 400, 240, 0);
    sim.setTurn(0, 1);
    // A full circle takes 2π / turnRate seconds; give it a bit longer.
    const ticks = Math.ceil(((2 * Math.PI) / SOLID.turnRate) * TICK_HZ * 1.2);
    const deaths = run(sim, ticks);
    expect(deaths).toEqual([0]);
  });

  it('does not kill you on your own freshly drawn trail when turning hard', () => {
    const sim = new TrailsSim(1, { rng: mulberry32(4), tuning: SOLID });
    place(sim, 0, 400, 240, 0);
    sim.setTurn(0, -1);
    const halfCircle = Math.floor((Math.PI / SOLID.turnRate) * TICK_HZ);
    expect(run(sim, halfCircle)).toEqual([]);
  });

  it('gaps let others slip through', () => {
    const sim = new TrailsSim(2, { rng: mulberry32(5), tuning: SOLID });
    place(sim, 0, 100, 240, 0);
    place(sim, 1, 400, 420, -Math.PI / 2);
    // Snake 0 is in a gap for the whole test: it leaves no trail.
    sim.snakes[0].gapTicks = 10_000;
    const deaths = run(sim, 4 * TICK_HZ);
    expect(deaths).not.toContain(1);
  });

  it('head-on crashes in the same tick kill both', () => {
    const sim = new TrailsSim(2, { rng: mulberry32(6), tuning: SOLID });
    place(sim, 0, 300, 240, 0);
    place(sim, 1, 500, 240, Math.PI);
    const deaths = run(sim, 3 * TICK_HZ);
    expect(deaths.sort()).toEqual([0, 1]);
  });

  it('ghosts (spawn phase) neither collide nor leave a trail', () => {
    const sim = new TrailsSim(2, { rng: mulberry32(7), tuning: { ...SOLID, ghostTime: 10 } });
    place(sim, 0, 300, 240, 0);
    place(sim, 1, 500, 240, Math.PI);
    sim.snakes[0].ghostTicks = sim.snakes[1].ghostTicks = 600;
    expect(run(sim, 2 * TICK_HZ)).toEqual([]);
    expect(sim.grid.owner.some((o) => o !== 0)).toBe(false);
  });

  it('fast lines cannot tunnel through thin trails', () => {
    const sim = new TrailsSim(2, { rng: mulberry32(8), tuning: SOLID });
    place(sim, 0, 100, 240, 0);
    sim.snakes[0].fx.thin = 100_000;
    place(sim, 1, 400, 420, -Math.PI / 2);
    sim.snakes[1].fx.speed = 100_000;
    run(sim, 3 * TICK_HZ);
    expect(sim.snakes[1].alive).toBe(false);
  });

  it('spawns everyone inside the arena, apart from each other', () => {
    const sim = new TrailsSim(8, { rng: mulberry32(9) });
    for (const s of sim.snakes) {
      expect(s.x).toBeGreaterThan(40);
      expect(s.x).toBeLessThan(760);
      expect(s.y).toBeGreaterThan(40);
      expect(s.y).toBeLessThan(440);
    }
    for (let i = 0; i < 8; i++)
      for (let j = i + 1; j < 8; j++) {
        const d = Math.hypot(sim.snakes[i].x - sim.snakes[j].x, sim.snakes[i].y - sim.snakes[j].y);
        expect(d).toBeGreaterThan(40);
      }
  });

  it('makes gaps of roughly the configured length', () => {
    const tuning: TrailsTuning = { ...TUNING, gapMin: 0.5, gapMax: 0.5, ghostTime: 0 };
    const sim = new TrailsSim(1, { rng: mulberry32(10), tuning });
    place(sim, 0, 50, 240, 0);
    let gapTicks = 0;
    for (let i = 0; i < 60; i++) {
      const ev = sim.step();
      if (ev.segments.length === 0) gapTicks++;
    }
    const expected = Math.round((tuning.gapLength / tuning.speed) * TICK_HZ);
    expect(gapTicks).toBeGreaterThanOrEqual(expected);
    expect(gapTicks).toBeLessThanOrEqual(expected + 1);
  });
});

describe('Trails scoring', () => {
  it('awards +1 to every survivor for each death', () => {
    expect(awardDeaths([0, 0, 0, 0], [3], [0, 1, 2])).toEqual([1, 1, 1, 0]);
    expect(awardDeaths([1, 1, 1, 0], [1, 2], [0])).toEqual([3, 1, 1, 0]);
  });
  it('simultaneous deaths do not score off each other', () => {
    expect(awardDeaths([0, 0, 0], [0, 1], [2])).toEqual([0, 0, 2]);
    expect(awardDeaths([0, 0], [0, 1], [])).toEqual([0, 0]);
  });
  it('target is 10 × (players − 1)', () => {
    expect(trailsTarget(2)).toBe(10);
    expect(trailsTarget(4)).toBe(30);
    expect(trailsTarget(8)).toBe(70);
  });
  it('declares a winner only at the target with a clear lead', () => {
    expect(trailsWinner([9, 3], 10)).toBeNull();
    expect(trailsWinner([10, 3], 10)).toBe(0);
    expect(trailsWinner([31, 31, 2], 30)).toBeNull();
    expect(trailsWinner([31, 32, 2], 30)).toBe(1);
  });
});

describe('power-ups', () => {
  const NORMAL: TrailsTuning = { ...TUNING, ghostTime: 0 };
  const fresh = (n = 3, tuning = NORMAL) => {
    const sim = new TrailsSim(n, { rng: mulberry32(21), tuning });
    sim.snakes.forEach((_, i) => place(sim, i, 150 + i * 200, 240, -Math.PI / 2));
    return sim;
  };

  it('speeds up or slows down you or everyone else', () => {
    const sim = fresh();
    const [a, b, c] = sim.snakes;
    sim.apply(a, 'speed');
    expect(sim.speedOf(a)).toBeCloseTo(TUNING.speed * POWER_TUNING.fast);
    sim.apply(a, 'rush');
    expect(sim.speedOf(a)).toBeCloseTo(TUNING.speed * POWER_TUNING.fast);
    expect(sim.speedOf(b)).toBeCloseTo(TUNING.speed * POWER_TUNING.fast);
    sim.apply(b, 'slow');
    // a is boosted and rushed, then slowed by b; c is rushed and slowed.
    expect(sim.speedOf(a)).toBeCloseTo(TUNING.speed * POWER_TUNING.fast * POWER_TUNING.slow);
    expect(sim.speedOf(c)).toBeCloseTo(TUNING.speed * POWER_TUNING.fast * POWER_TUNING.slow);
    expect(sim.speedOf(b)).toBeCloseTo(TUNING.speed * POWER_TUNING.fast);
    sim.apply(c, 'brake');
    expect(sim.speedOf(c)).toBeCloseTo(TUNING.speed * POWER_TUNING.fast * POWER_TUNING.slow ** 2);
  });

  it('makes your line thin, or everyone else’s fat, and the two cancel', () => {
    const sim = fresh();
    const [a, b] = sim.snakes;
    sim.apply(a, 'fat');
    expect(sim.radiusOf(a)).toBe(TUNING.radius);
    expect(sim.radiusOf(b)).toBeCloseTo(TUNING.radius * POWER_TUNING.fat);
    sim.apply(b, 'thin');
    expect(sim.radiusOf(b)).toBeCloseTo(TUNING.radius * POWER_TUNING.thin);
  });

  it('fat lines paint wider trails and survive their own fresh trail', () => {
    const sim = fresh(2, SOLID);
    sim.apply(sim.snakes[1], 'fat');
    run(sim, TICK_HZ);
    expect(sim.snakes[0].alive).toBe(true);
    const s = sim.snakes[0];
    const behind = Math.floor(s.y + 30);
    let width = 0;
    for (let x = 0; x < sim.w; x++) if (sim.grid.owner[behind * sim.w + x] === 1) width++;
    expect(width).toBeGreaterThanOrEqual(Math.floor(TUNING.radius * POWER_TUNING.fat * 2) - 1);
  });

  /** Count trail-less ticks for snake 0 over `ticks`. */
  function gapTicks(sim: TrailsSim, ticks: number) {
    let n = 0;
    for (let i = 0; i < ticks; i++) {
      sim.step();
      if (sim.snakes[0].gapTicks > 0) n++;
      sim.snakes.forEach((s, k) => (s.alive ? null : place(sim, k, 400, 240, 0)));
      sim.snakes.forEach((s) => (s.alive = true));
    }
    return n;
  }

  it('gives you big frequent gaps, or takes everyone else’s away', () => {
    const holes = fresh(2);
    holes.snakes[0].fx.holes = 100_000;
    const normal = fresh(2);
    expect(gapTicks(holes, 3 * TICK_HZ)).toBeGreaterThan(gapTicks(normal, 3 * TICK_HZ) * 2);

    const solid = fresh(2);
    solid.apply(solid.snakes[1], 'solid');
    expect(gapTicks(solid, 4 * TICK_HZ)).toBe(0);
  });

  it('lets a jumping line hop over other trails (but not walls)', () => {
    const sim = new TrailsSim(2, { rng: mulberry32(3), tuning: SOLID });
    // Snake 0 draws a horizontal line across the middle while snake 1 waits.
    place(sim, 0, 100, 240, 0);
    sim.snakes[1].alive = false;
    run(sim, 4 * TICK_HZ);
    // Snake 1 drives straight up through that line, jumping.
    place(sim, 1, 300, 290, -Math.PI / 2);
    sim.snakes[1].alive = true;
    sim.apply(sim.snakes[1], 'jump');
    run(sim, 50);
    expect(sim.snakes[1].alive).toBe(true);
    expect(sim.snakes[1].y).toBeLessThan(230);
    // Once the jump is over it hits the top wall.
    run(sim, 4 * TICK_HZ);
    expect(sim.snakes[1].alive).toBe(false);
  });

  it('clears the arena', () => {
    const sim = fresh(2, SOLID);
    run(sim, 30);
    expect(sim.grid.owner.some((o) => o !== 0)).toBe(true);
    sim.apply(sim.snakes[0], 'clear');
    expect(sim.grid.owner.some((o) => o !== 0)).toBe(false);
  });

  it('spawns every kind of power-up and lets lines pick them up', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 40 && seen.size < POWER_KINDS.length; seed++) {
      const sim = new TrailsSim(2, { rng: mulberry32(seed), powerups: true, tuning: NORMAL });
      for (let i = 0; i < 30 * TICK_HZ; i++) {
        sim.step();
        for (const p of sim.powerups) seen.add(p.kind);
        sim.snakes.forEach((s, k) => {
          if (!s.alive) {
            s.alive = true;
            place(sim, k, 400, 240, k);
          }
        });
      }
    }
    expect(seen.size).toBe(POWER_KINDS.length);
    const sim = new TrailsSim(1, { rng: mulberry32(1), powerups: true, tuning: SOLID });
    place(sim, 0, 100, 240, 0);
    sim.powerups.push({ id: 99, kind: 'thin', x: 120, y: 240 });
    let got = null as string | null;
    for (let i = 0; i < 30 && !got; i++) got = sim.step().pickups[0]?.kind ?? null;
    expect(got).toBe('thin');
    expect(sim.snakes[0].fx.thin).toBeGreaterThan(0);
  });
});
