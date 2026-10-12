import { describe, expect, it } from 'vitest';
import {
  AIR_TIME,
  CLEAR,
  DT,
  FASTEST,
  FIRST_PERIOD,
  MAX_JUMPS,
  MIN_PERIOD,
  RopeSim,
  WAIT_TIME,
  basePeriod,
  clearWindow,
  howTo,
  ropeAt,
  turnFor,
  type RopeEvent,
} from '../client/src/games/rope/logic';
import { mulberry32 } from '../client/src/games/rng';
import { eliminationPoints, eliminationWinners } from '../client/src/games/arena/elimination';

/** Run the sim; `jumper(i, sim)` says whether player i presses JUMP this step. */
function run(sim: RopeSim, seconds: number, jumper: (i: number, sim: RopeSim) => boolean = () => false) {
  const all: RopeEvent[] = [];
  for (let k = 0; k < Math.round(seconds / DT); k++) all.push(...sim.step(sim.players.map((_, i) => (jumper(i, sim) ? 1 : 0))));
  return all;
}

/** A perfect jumper: presses when the rope is this long from the ground. */
function perfect(lead = (clearWindow().from + clearWindow().to) / 2) {
  return (_i: number, sim: RopeSim) => {
    if (sim.phase !== 'turn') return false;
    const toGround = (0.5 - sim.rope) * sim.period;
    return toGround > 0 && toGround <= lead && toGround > lead - DT * 1.01;
  };
}

describe('the rope', () => {
  it('is at the top at 0, in front at 0.25 and on the ground at 0.5', () => {
    expect(ropeAt(0).y).toBeGreaterThan(2.5);
    expect(ropeAt(0.25).z).toBeGreaterThan(1);
    expect(ropeAt(0.5).y).toBeLessThan(0.1);
  });
  it('turns faster and faster, down to a floor', () => {
    expect(basePeriod(1)).toBe(FIRST_PERIOD);
    for (let n = 2; n < 60; n++) expect(basePeriod(n + 1)).toBeLessThanOrEqual(basePeriod(n));
    expect(basePeriod(60)).toBe(MIN_PERIOD);
  });
  it('has surprises only later, and never quicker than FASTEST', () => {
    const rng = mulberry32(3);
    for (let n = 1; n < 8; n++) expect(turnFor(n, rng).kind).toBe('normal');
    const kinds = new Set<string>();
    for (let k = 0; k < 400; k++) {
      const t = turnFor(10 + (k % 40), rng);
      kinds.add(t.kind);
      expect(t.period).toBeGreaterThanOrEqual(FASTEST - 1e-9);
    }
    expect(kinds).toEqual(new Set(['normal', 'slow', 'fast']));
  });
  it('can always be jumped: a jump clears the rope for long enough and lands in time', () => {
    const w = clearWindow();
    expect(w.to - w.from).toBeGreaterThan(0.25);
    expect(AIR_TIME).toBeLessThan(FASTEST);
  });
});

describe('a round', () => {
  it('waits, then starts at the top', () => {
    const sim = new RopeSim(2, mulberry32(1));
    sim.begin();
    const ev = run(sim, WAIT_TIME + 0.05);
    expect(ev.some((e) => e.t === 'turn' && e.n === 1)).toBe(true);
    expect(sim.rope).toBeLessThan(0.1);
  });
  it('trips anybody on the ground when the rope sweeps by', () => {
    const sim = new RopeSim(3, mulberry32(1));
    sim.begin();
    const ev = run(sim, WAIT_TIME + FIRST_PERIOD * 0.6, (i, s) => i === 0 && perfect()(i, s));
    const pass = ev.find((e) => e.t === 'pass');
    expect(pass).toMatchObject({ n: 1, cleared: [0], tripped: [1, 2] });
    expect(sim.players[1].outAt).toBe(1);
    expect(ev.some((e) => e.t === 'over')).toBe(true);
  });
  it('a perfect jumper lasts until the babcias give up', () => {
    const sim = new RopeSim(1, mulberry32(5));
    sim.begin();
    const ev = run(sim, 80, perfect());
    expect(sim.passes).toBe(MAX_JUMPS);
    expect(sim.players[0].alive).toBe(true);
    expect(sim.players[0].jumps).toBe(MAX_JUMPS);
    expect(ev.filter((e) => e.t === 'over')).toHaveLength(1);
    expect(sim.results().points).toEqual([MAX_JUMPS]);
  });
  it('jumping too early or too late trips you', () => {
    for (const lead of [clearWindow().to + 0.06, clearWindow().from - 0.05]) {
      const sim = new RopeSim(1, mulberry32(2));
      sim.begin();
      run(sim, WAIT_TIME + FIRST_PERIOD, perfect(lead));
      expect(sim.players[0].alive).toBe(false);
      expect(sim.players[0].outAt).toBe(1);
    }
  });
  it('you cannot jump in mid-air, but a press just before landing still counts', () => {
    const sim = new RopeSim(1, mulberry32(2));
    sim.begin();
    run(sim, 0.1, (_, s) => s.time < DT * 1.5);
    expect(sim.players[0].y).toBeGreaterThan(0);
    const t0 = sim.time;
    // Press again a little before landing: the second jump starts on touch-down.
    const ev = run(sim, 0.9, (_, s) => Math.abs(s.time - t0 - (AIR_TIME - 0.1 - 0.05)) < DT / 2);
    expect(ev.filter((e) => e.t === 'jump')).toHaveLength(1);
    expect(ev.filter((e) => e.t === 'land')).toHaveLength(2);
  });
  it('is a tie when the last ones trip together', () => {
    const sim = new RopeSim(3, mulberry32(1));
    sim.begin();
    run(sim, WAIT_TIME + FIRST_PERIOD * 2.6, (i, s) => (i === 0 ? false : s.n < 2 && perfect()(i, s)));
    expect(sim.over).toBe(true);
    const r = sim.results();
    expect(r.winners).toEqual([1, 2]);
    expect(r.points).toEqual([0, 3, 3]);
  });
  it('ends when somebody leaves and only one is left', () => {
    const sim = new RopeSim(2, mulberry32(1));
    sim.begin();
    run(sim, 0.5);
    sim.remove(1);
    const ev = run(sim, DT);
    expect(ev).toContainEqual({ t: 'over' });
    expect(sim.results().points).toEqual([2, 0]);
  });
  it('the clearance is about knee height', () => {
    expect(CLEAR).toBeGreaterThan(0.2);
    expect(CLEAR).toBeLessThan(0.5);
  });
});

describe('scoring', () => {
  it('counts the players who went out before you, +2 for the last ones standing', () => {
    expect(eliminationPoints([3, null, 5, 3], [false, false, false, false], false, 9)).toEqual([0, 5, 2, 0]);
    expect(eliminationWinners([3, null, 5, 3], [false, false, false, false], false)).toEqual([1]);
    expect(eliminationPoints([4, 4], [false, false], false, 4)).toEqual([2, 2]);
  });
  it('gives players who left nothing, and solo players how far they got', () => {
    expect(eliminationPoints([2, null, 5], [false, true, false], false, 5)).toEqual([0, 0, 3]);
    expect(eliminationPoints([7], [false], true, 7)).toEqual([6]);
    expect(eliminationPoints([null], [false], true, 12)).toEqual([12]);
  });
});

it('has a three-line how-to', () => {
  expect(howTo(false)).toHaveLength(3);
  expect(howTo(true)[2]).toMatch(/One round/);
});
