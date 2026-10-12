import { describe, expect, it } from 'vitest';
import {
  ABSENT_TURN_TIME,
  BOOM_TIME,
  BlastSim,
  DT,
  FUSE_TIME,
  SAFE_TIME,
  SETUP_TIME,
  TURN_TIME,
  howTo,
  type BlastEvent,
  type BlastInput,
} from '../client/src/games/blast/logic';
import { mulberry32 } from '../client/src/games/rng';

const idle = (n: number, live = true): BlastInput[] => Array.from({ length: n }, () => ({ x: 0, push: 0, live }));

function run(sim: BlastSim, seconds: number, input: (sim: BlastSim) => BlastInput[] = (s) => idle(s.players.length)) {
  const all: BlastEvent[] = [];
  for (let k = 0; k < Math.round(seconds / DT); k++) all.push(...sim.step(input(sim)));
  return all;
}

/** Everyone pushes straight away, whatever is selected. */
const eager = (s: BlastSim) => s.players.map((_, i) => ({ x: 0, push: s.phase === 'choose' && s.current === i ? 1 : 0, live: true }));

function playOut(sim: BlastSim) {
  sim.begin();
  return run(sim, 400, eager);
}

describe('a set', () => {
  it('has a plunger for every player and one live one', () => {
    const sim = new BlastSim(5, mulberry32(1));
    sim.begin();
    expect(sim.set).toBe(1);
    expect(sim.plungers).toHaveLength(5);
    expect(sim.bomb).toBeGreaterThanOrEqual(0);
    expect(sim.bomb).toBeLessThan(5);
    expect([...sim.order].sort()).toEqual([0, 1, 2, 3, 4]);
  });
  it('blasts exactly one player per set, and the next set has one plunger fewer', () => {
    const sim = new BlastSim(4, mulberry32(2));
    const ev = playOut(sim);
    expect(ev.filter((e) => e.t === 'boom')).toHaveLength(3);
    expect(ev.filter((e) => e.t === 'set').map((e) => (e as { plungers: number }).plungers)).toEqual([4, 3, 2]);
    expect(sim.aliveCount).toBe(1);
    expect(ev.filter((e) => e.t === 'over')).toHaveLength(1);
  });
  it('lets the turn player move the selection over free plungers and push', () => {
    const sim = new BlastSim(3, mulberry32(4));
    sim.begin();
    run(sim, SETUP_TIME + DT * 2);
    expect(sim.phase).toBe('choose');
    const me = sim.current;
    const start = sim.cursor;
    const lean = (x: number) => (s: BlastSim) => s.players.map((_, i) => ({ x: i === me ? x : 0, push: 0, live: true }));
    // A quick lean right moves one step; holding it moves on after the repeat delay; the end stops it.
    run(sim, DT, lean(1));
    expect(sim.cursor).toBe(Math.min(2, start + 1));
    run(sim, 1, lean(1));
    expect(sim.cursor).toBe(2);
    run(sim, DT, lean(0));
    run(sim, 1, lean(-1));
    expect(sim.cursor).toBe(0);
    const ev = run(sim, DT, (s) => s.players.map((_, i) => ({ x: 0, push: i === me ? 1 : 0, live: true })));
    expect(ev).toContainEqual({ t: 'push', i: me, plunger: 0, auto: false });
    expect(sim.plungers[0].used).toBe(true);
    // Somebody else's buttons do nothing.
    expect(sim.phase).toBe('fuse');
  });
  it('skips used plungers', () => {
    const sim = new BlastSim(4, mulberry32(9));
    sim.begin();
    sim.plungers[1].used = true;
    sim.cursor = 0;
    sim.moveCursor(1);
    expect(sim.cursor).toBe(2);
    sim.moveCursor(-1);
    expect(sim.cursor).toBe(0);
  });
  it('pushes one for you when time runs out (quicker if you are away)', () => {
    const sim = new BlastSim(2, mulberry32(3));
    sim.begin();
    let ev = run(sim, SETUP_TIME + TURN_TIME - 0.2);
    expect(ev.some((e) => e.t === 'push')).toBe(false);
    ev = run(sim, 0.4);
    expect(ev.find((e) => e.t === 'push')).toMatchObject({ auto: true });
    const away = new BlastSim(2, mulberry32(3));
    away.begin();
    ev = run(away, SETUP_TIME + ABSENT_TURN_TIME + 0.1, (s) => idle(s.players.length, false));
    expect(ev.find((e) => e.t === 'push')).toMatchObject({ auto: true });
  });
  it('a dud is safe and the next player goes; the live one blasts you', () => {
    const sim = new BlastSim(3, mulberry32(6));
    sim.begin();
    run(sim, SETUP_TIME + DT * 2);
    const first = sim.current;
    sim.cursor = (sim.bomb + 1) % 3;
    let ev = run(sim, DT, eager);
    ev = run(sim, FUSE_TIME + DT * 2);
    expect(ev).toContainEqual({ t: 'safe', i: first, plunger: (sim.bomb + 1) % 3 });
    ev = run(sim, SAFE_TIME + DT * 2);
    const second = sim.current;
    expect(second).not.toBe(first);
    sim.cursor = sim.bomb;
    run(sim, DT, eager);
    ev = run(sim, FUSE_TIME + DT * 2);
    expect(ev).toContainEqual({ t: 'boom', i: second, plunger: sim.bomb });
    expect(sim.players[second].alive).toBe(false);
    expect(sim.players[second].outAt).toBe(1);
    // The next set starts with the player after the one blasted.
    run(sim, BOOM_TIME + DT * 2);
    expect(sim.set).toBe(2);
    const alive = [0, 1, 2].filter((i) => i !== second);
    expect(sim.order[0]).toBe(alive.find((i) => i > second) ?? alive[0]);
  });
  it('gives everyone the same chance', () => {
    const outs = [0, 0, 0, 0];
    for (let seed = 1; seed <= 800; seed++) {
      const sim = new BlastSim(4, mulberry32(seed));
      sim.begin();
      run(sim, 40, eager);
      const first = sim.players.findIndex((p) => p.outAt === 1);
      outs[first]++;
    }
    for (const n of outs) expect(n).toBeGreaterThan(150);
  });
});

describe('players leaving', () => {
  it('takes a dud away when somebody who has not pushed leaves', () => {
    const sim = new BlastSim(4, mulberry32(8));
    sim.begin();
    run(sim, SETUP_TIME + DT * 2);
    const later = sim.order[2];
    sim.remove(later);
    expect(sim.left).toBe(3);
    expect(sim.plungers[sim.bomb].used).toBe(false);
    expect(sim.order).not.toContain(later);
  });
  it('moves on when the player whose turn it is leaves', () => {
    const sim = new BlastSim(3, mulberry32(8));
    sim.begin();
    run(sim, SETUP_TIME + DT * 2);
    const cur = sim.current;
    sim.remove(cur);
    expect(sim.phase).toBe('choose');
    expect(sim.current).not.toBe(cur);
    expect(sim.left).toBe(2);
  });
  it('always finds the live plunger, however people come and go', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = mulberry32(seed);
      const sim = new BlastSim(6, mulberry32(seed + 1000));
      sim.begin();
      let left = 2;
      for (let k = 0; k < 4000 && !sim.over; k++) {
        if (left > 0 && rng() < 0.002) {
          const alive = sim.players.map((_, i) => i).filter((i) => sim.players[i].alive);
          sim.remove(alive[Math.floor(rng() * alive.length)]);
          left--;
        }
        sim.step(eager(sim));
        if (sim.phase === 'choose') expect(sim.left).toBe(sim.order.length - sim.turn);
      }
      expect(sim.over).toBe(true);
      expect(sim.aliveCount).toBeLessThanOrEqual(1);
    }
  });
});

describe('scoring', () => {
  it('scores by how long you lasted, +2 for the survivor', () => {
    const sim = new BlastSim(3, mulberry32(11));
    playOut(sim);
    const r = sim.results();
    const winner = sim.players.findIndex((p) => p.alive);
    expect(r.winners).toEqual([winner]);
    expect(r.points[winner]).toBe(4);
    expect([...r.points].sort()).toEqual([0, 1, 4]);
  });
});

it('has a three-line how-to', () => {
  expect(howTo(false)).toHaveLength(3);
  expect(howTo(true)[2]).toMatch(/One round/);
});
