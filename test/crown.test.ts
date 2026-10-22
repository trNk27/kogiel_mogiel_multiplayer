import { describe, expect, it } from 'vitest';
import {
  COLUMNS,
  CROWN_CLEAR,
  CROWN_SLOW,
  CrownSim,
  DASH_CD,
  DAZE,
  DOUBLE_S,
  DT,
  FLIGHT,
  FOUNTAIN_R,
  FOUNTAIN_TOP,
  HALF_D,
  HALF_W,
  IMMUNE,
  KNOCK_MAX,
  PLAYER_R,
  ROUNDS,
  ROUNDS_SHORT,
  ROUND_S,
  START_FLIGHT,
  START_MAX,
  START_MIN,
  WALK,
  botInput,
  howTo,
  isClear,
  placeText,
  pointsFor,
  settle,
  spawnAt,
  type CrownEvent,
  type CrownInput,
} from '../client/src/games/crown/logic';
import { mulberry32 } from '../client/src/games/rng';

type Pilot = (i: number, sim: CrownSim) => CrownInput | undefined;

/** Run the sim for `seconds`; `pilot(i, sim)` gives player i's input each step. */
function run(sim: CrownSim, seconds: number, pilot: Pilot = () => undefined) {
  const all: CrownEvent[] = [];
  for (let k = 0; k < Math.round(seconds / DT); k++) all.push(...sim.step(sim.players.map((_, i) => pilot(i, sim))));
  return all;
}

/** A started sim whose crown has landed, with everybody moved out of the way to the edges. */
function started(n: number, seed = 1) {
  const sim = new CrownSim(n, { rng: mulberry32(seed) });
  sim.players.forEach((p, i) => {
    p.x = -HALF_W + 1 + i * 1.6;
    p.z = -HALF_D + 1;
  });
  sim.begin();
  run(sim, START_FLIGHT + DT);
  return sim;
}

/** Put player i at (x, z), standing still. */
function place(sim: CrownSim, i: number, x: number, z: number) {
  const p = sim.players[i];
  p.x = x;
  p.z = z;
  p.vx = p.vz = 0;
}

describe('the courtyard', () => {
  it('pushes points out of the fountain and the columns and back inside the walls', () => {
    const a = settle(0.3, 0.2, CROWN_CLEAR);
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(FOUNTAIN_R + CROWN_CLEAR, 5);
    const b = settle(COLUMNS[0].x, COLUMNS[0].z, CROWN_CLEAR);
    expect(isClear(b.x, b.z, CROWN_CLEAR)).toBe(true);
    const c = settle(40, -40, CROWN_CLEAR);
    expect(c).toEqual({ x: HALF_W - CROWN_CLEAR, z: -HALF_D + CROWN_CLEAR });
    expect(isClear(0, 0, 0.1)).toBe(false);
    expect(isClear(HALF_W + 1, 0, 0.1)).toBe(false);
    expect(isClear(0, HALF_D - 1, 0.5)).toBe(true);
  });
  it('starts everybody on clear, separate spots round the fountain', () => {
    for (let n = 1; n <= 8; n++) {
      const spots = Array.from({ length: n }, (_, i) => spawnAt(i, n));
      for (const s of spots) expect(isClear(s.x, s.z, PLAYER_R)).toBe(true);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z)).toBeGreaterThan(PLAYER_R * 2);
    }
  });
});

describe('the start', () => {
  it('keeps the crown on the fountain and nothing moving until GO', () => {
    const sim = new CrownSim(3, { rng: mulberry32(2) });
    const ev = run(sim, 1, () => ({ x: 1, z: 0, dash: true }));
    expect(ev).toEqual([]);
    expect(sim.time).toBe(0);
    expect(sim.crown).toMatchObject({ state: 'flying', x: 0, z: 0, y: FOUNTAIN_TOP, t: 0 });
    expect(sim.players[0].vx).toBe(0);
  });
  it('the fountain spits the crown out to a clear spot a few metres from the middle', () => {
    for (let seed = 1; seed < 40; seed++) {
      const sim = new CrownSim(2, { rng: mulberry32(seed) });
      const launch = sim.begin();
      expect(launch).toHaveLength(1);
      expect(sim.begin()).toEqual([]);
      sim.players.forEach((p) => (p.z = -HALF_D + 1));
      const ev = run(sim, START_FLIGHT + DT * 2);
      const land = ev.find((e) => e.t === 'land');
      expect(land).toBeTruthy();
      expect(sim.crown.state).toBe('loose');
      const d = Math.hypot(sim.crown.x, sim.crown.z);
      expect(d).toBeGreaterThanOrEqual(START_MIN - 1e-6);
      expect(d).toBeLessThanOrEqual(START_MAX + 1e-6);
      expect(isClear(sim.crown.x, sim.crown.z, CROWN_CLEAR)).toBe(true);
    }
  });
  it('flies in an arc: up from the fountain, down to the ground', () => {
    const sim = new CrownSim(2, { rng: mulberry32(4) });
    sim.begin();
    run(sim, START_FLIGHT * 0.3);
    expect(sim.crown.y).toBeGreaterThan(FOUNTAIN_TOP);
    run(sim, START_FLIGHT * 0.69);
    expect(sim.crown.y).toBeLessThan(1.5);
  });
});

describe('wearing the crown', () => {
  it('goes to whoever touches the loose crown first', () => {
    const sim = started(3);
    place(sim, 2, sim.crown.x + 0.5, sim.crown.z);
    const ev = run(sim, DT);
    expect(ev).toContainEqual({ t: 'pickup', p: 2, first: true });
    expect(sim.wearer).toBe(2);
    expect(sim.firstWearer).toBe(2);
    expect(sim.crown.immune).toBeCloseTo(IMMUNE, 5);
  });
  it('goes to the nearest one when two reach it together', () => {
    const sim = started(3);
    const { x, z } = sim.crown;
    place(sim, 0, x - 1.0, z);
    place(sim, 1, x + 0.6, z);
    run(sim, DT);
    expect(sim.wearer).toBe(1);
  });
  it('can be walked to', () => {
    const sim = started(2);
    place(sim, 0, sim.crown.x - 4, sim.crown.z);
    if (!isClear(sim.players[0].x, sim.players[0].z, PLAYER_R)) place(sim, 0, sim.crown.x + 4 * Math.sign(-sim.crown.x || 1), sim.crown.z);
    const ev = run(sim, 2, (i, s) => (i === 0 ? botInput(s, 0) : undefined));
    expect(ev.some((e) => e.t === 'pickup' && e.p === 0)).toBe(true);
  });
  it('scores one point a second', () => {
    const sim = started(2);
    sim.give(0);
    const before = sim.time;
    run(sim, 10);
    expect(sim.time - before).toBeCloseTo(10, 5);
    expect(sim.points(0)).toBe(10);
    expect(sim.points(1)).toBe(0);
    expect(pointsFor(59)).toBe(0);
    expect(pointsFor(60)).toBe(1);
  });
  it('scores double in the last ten seconds', () => {
    const sim = new CrownSim(2, { rng: mulberry32(3) });
    sim.begin();
    sim.give(0);
    const ev = run(sim, ROUND_S - DOUBLE_S - 0.5);
    expect(ev.some((e) => e.t === 'double')).toBe(false);
    expect(sim.double).toBe(false);
    const ev2 = run(sim, 1);
    expect(ev2.filter((e) => e.t === 'double')).toHaveLength(1);
    expect(sim.double).toBe(true);
    run(sim, ROUND_S);
    expect(sim.done).toBe(true);
    // 50 s single, 10 s double.
    expect(sim.points(0)).toBe(ROUND_S - DOUBLE_S + 2 * DOUBLE_S);
  });
  it('slows the wearer down', () => {
    const sim = started(2);
    place(sim, 0, -11, 6.2);
    place(sim, 1, -11, -6.2);
    sim.give(0);
    run(sim, 1, () => ({ x: 1, z: 0 }));
    expect(sim.players[0].vx).toBeCloseTo(WALK * CROWN_SLOW, 5);
    expect(sim.players[1].vx).toBeCloseTo(WALK, 5);
    const ratio = (sim.players[0].x + 11) / (sim.players[1].x + 11);
    expect(ratio).toBeGreaterThan(CROWN_SLOW - 0.03);
    expect(ratio).toBeLessThan(CROWN_SLOW + 0.03);
    // Without the crown you're back to full speed.
    sim.crown.state = 'loose';
    sim.crown.wearer = -1;
    sim.crown.x = sim.crown.z = 99;
    run(sim, 0.5, () => ({ x: 1, z: 0 }));
    expect(sim.players[0].vx).toBeCloseTo(WALK, 5);
  });
});

describe('stealing', () => {
  /** Wearer 0 on the right, dasher 1 to its left facing it, immunity worn off. */
  function lineUp(seed = 1) {
    const sim = started(2, seed);
    place(sim, 0, 3, 5.5);
    place(sim, 1, 0.6, 5.5);
    sim.give(0);
    run(sim, IMMUNE + DT);
    sim.players[1].fx = 1;
    sim.players[1].fz = 0;
    return sim;
  }

  it('a dash into the wearer knocks the crown off and dazes them', () => {
    const sim = lineUp();
    const ev = run(sim, 0.2, (i) => (i === 1 ? { x: 0, z: 0, dash: true } : undefined));
    const steal = ev.find((e) => e.t === 'steal');
    expect(steal).toMatchObject({ t: 'steal', by: 1, from: 0 });
    expect(ev.filter((e) => e.t === 'dash')).toHaveLength(1);
    expect(sim.crown.state).toBe('flying');
    expect(sim.wearer).toBe(-1);
    expect(sim.players[0].daze).toBeGreaterThan(DAZE - 0.25);
    expect(sim.players[1].steals).toBe(1);
    // The old wearer was knocked along the dash.
    expect(sim.players[0].x).toBeGreaterThan(3);
  });
  it('the crown lands 3–5 m away, inside the courtyard and clear of everything', () => {
    for (let seed = 1; seed < 120; seed++) {
      const sim = started(2, seed);
      // Wearers all over the courtyard, the corners and next to the fountain included.
      const spots = [
        [HALF_W - 1, HALF_D - 1],
        [-HALF_W + 1, -HALF_D + 1],
        [0, FOUNTAIN_R + PLAYER_R + 0.1],
        [COLUMNS[1].x + 1.3, COLUMNS[1].z],
      ];
      const [x, z] = spots[seed % spots.length];
      place(sim, 0, x, z);
      sim.give(0);
      sim.knockOff(0, 1);
      const tx = sim.crown.tx;
      const tz = sim.crown.tz;
      expect(isClear(tx, tz, CROWN_CLEAR)).toBe(true);
      expect(Math.hypot(tx - x, tz - z)).toBeLessThanOrEqual(KNOCK_MAX + FOUNTAIN_R + 1);
      if (seed % spots.length === 0) continue;
      place(sim, 0, -HALF_W + 1, HALF_D - 1);
      place(sim, 1, -HALF_W + 3, HALF_D - 1);
      if (Math.hypot(tx - sim.players[0].x, tz - sim.players[0].z) < 3) continue;
      const ev = run(sim, FLIGHT + DT);
      expect(ev).toContainEqual({ t: 'land', x: tx, z: tz });
      expect(sim.crown).toMatchObject({ state: 'loose', y: 0 });
    }
  });
  it('lands 3–5 m away in open ground', () => {
    for (let seed = 1; seed < 60; seed++) {
      const sim = started(2, seed);
      place(sim, 0, 0, 0);
      // Nothing in the way for 5 m round (0, 0)? The fountain is: use the open left side instead.
      place(sim, 0, -HALF_W + 6, 0);
      sim.give(0);
      sim.knockOff(0, 1);
      const d = Math.hypot(sim.crown.tx - sim.players[0].x, sim.crown.tz);
      // Clamped against a wall it can be a little shorter.
      expect(d).toBeLessThanOrEqual(5 + 1e-6);
      if (Math.abs(sim.crown.tz) < HALF_D - CROWN_CLEAR - 1e-6 && isClear(sim.crown.tx, sim.crown.tz, CROWN_CLEAR + 0.01)) expect(d).toBeGreaterThanOrEqual(3 - 1e-6);
    }
  });
  it('a new wearer is safe for a second', () => {
    const sim = started(2);
    place(sim, 0, 3, 5.5);
    place(sim, 1, 0.6, 5.5);
    sim.give(0);
    sim.players[1].fx = 1;
    sim.players[1].fz = 0;
    const ev = run(sim, 0.3, (i) => (i === 1 ? { x: 0, z: 0, dash: true } : undefined));
    expect(ev.some((e) => e.t === 'steal')).toBe(false);
    expect(sim.wearer).toBe(0);
    // Once the immunity is over (and the dash has cooled down) it works.
    run(sim, DASH_CD);
    place(sim, 0, 3, 5.5);
    place(sim, 1, 0.6, 5.5);
    sim.players[1].fx = 1;
    sim.players[1].fz = 0;
    const ev2 = run(sim, 0.3, (i) => (i === 1 ? { x: 0, z: 0, dash: true } : undefined));
    expect(ev2.some((e) => e.t === 'steal')).toBe(true);
  });
  it('the dazed old wearer cannot grab it straight back, but can once the daze wears off', () => {
    const sim = lineUp(5);
    run(sim, 0.2, (i) => (i === 1 ? { x: 0, z: 0, dash: true } : undefined));
    expect(sim.crown.state).toBe('flying');
    place(sim, 0, sim.crown.tx, sim.crown.tz);
    place(sim, 1, -HALF_W + 1, -HALF_D + 1);
    const left = sim.crown.dur - sim.crown.t;
    const ev = run(sim, left + DT);
    expect(ev.some((e) => e.t === 'land')).toBe(true);
    expect(sim.players[0].daze).toBeGreaterThan(0);
    expect(sim.wearer).toBe(-1);
    run(sim, 0.3);
    expect(sim.wearer).toBe(0);
  });
  it('the dash only works every few seconds', () => {
    const sim = started(2);
    place(sim, 0, -8, 6);
    const ev = run(sim, DASH_CD + 0.5, (i) => (i === 0 ? { x: 0, z: 0, dash: true } : undefined));
    expect(ev.filter((e) => e.t === 'dash')).toHaveLength(2);
  });
  it('a dash into somebody without the crown is just a shove', () => {
    const sim = started(3);
    sim.give(2);
    place(sim, 2, HALF_W - 1, -HALF_D + 1);
    place(sim, 0, 3, 5.5);
    place(sim, 1, 0.6, 5.5);
    sim.players[1].fx = 1;
    sim.players[1].fz = 0;
    const ev = run(sim, 0.2, (i) => (i === 1 ? { x: 0, z: 0, dash: true } : undefined));
    expect(ev).toContainEqual({ t: 'bump', p: 0, by: 1 });
    expect(sim.players[0].daze).toBe(0);
    expect(sim.players[0].vx).toBeGreaterThan(0);
    expect(sim.wearer).toBe(2);
  });
});

describe('the round', () => {
  it('ends after 60 s, once', () => {
    const sim = new CrownSim(2, { rng: mulberry32(9) });
    sim.begin();
    const ev = run(sim, ROUND_S + 1);
    expect(ev.filter((e) => e.t === 'over')).toHaveLength(1);
    expect(sim.done).toBe(true);
    expect(sim.time).toBeCloseTo(ROUND_S, 5);
    expect(sim.left).toBe(0);
    expect(run(sim, 1)).toEqual([]);
  });
  it('a shorter round can be asked for', () => {
    const sim = new CrownSim(2, { rng: mulberry32(9), length: 5 });
    sim.begin();
    sim.give(1);
    run(sim, 6);
    expect(sim.done).toBe(true);
    // All five seconds are inside the last ten: double.
    expect(sim.points(1)).toBe(10);
  });
  it('ranks by points, ties in join order, and finds the winners', () => {
    const sim = new CrownSim(3, { rng: mulberry32(9) });
    sim.players[0].ticks = 120;
    sim.players[1].ticks = 300;
    sim.players[2].ticks = 179;
    expect(sim.results()).toEqual([2, 5, 2]);
    expect(sim.ranking()).toEqual([1, 0, 2]);
    expect(sim.winners()).toEqual([1]);
    sim.players[0].ticks = 300;
    expect(sim.winners()).toEqual([0, 1]);
    const none = new CrownSim(2);
    expect(none.winners()).toEqual([]);
  });
  it('plays a whole round with computer players, everyone staying inside', () => {
    for (const n of [2, 4, 8]) {
      const sim = new CrownSim(n, { rng: mulberry32(n * 7) });
      sim.begin();
      let pickups = 0;
      for (let k = 0; k < Math.round((ROUND_S + 1) / DT); k++) {
        const ev = sim.step(sim.players.map((_, i) => botInput(sim, i)));
        pickups += ev.filter((e) => e.t === 'pickup').length;
        for (const p of sim.players) {
          expect(Math.abs(p.x)).toBeLessThanOrEqual(HALF_W - PLAYER_R + 1e-6);
          expect(Math.abs(p.z)).toBeLessThanOrEqual(HALF_D - PLAYER_R + 1e-6);
        }
      }
      expect(sim.done).toBe(true);
      expect(pickups).toBeGreaterThanOrEqual(2);
      const total = sim.results().reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(20);
      expect(total).toBeLessThanOrEqual(ROUND_S + DOUBLE_S);
      for (const p of sim.players) expect(isClear(p.x, p.z, PLAYER_R - 0.05)).toBe(true);
    }
  });
});

describe('leaving', () => {
  it('a removed wearer drops the crown where they stood, and scores nothing', () => {
    const sim = started(3);
    place(sim, 1, 5, 5.5);
    sim.give(1);
    run(sim, 3);
    expect(sim.points(1)).toBe(3);
    const ev = sim.remove(1);
    expect(ev).toEqual([{ t: 'drop', p: 1, tx: expect.any(Number), tz: expect.any(Number) }]);
    expect(sim.crown.state).toBe('flying');
    expect(Math.hypot(sim.crown.tx - 5, sim.crown.tz - 5.5)).toBeLessThan(0.1);
    expect(sim.points(1)).toBe(0);
    expect(sim.ranking()).not.toContain(1);
    expect(sim.active).toBe(2);
    run(sim, 1);
    expect(sim.crown.state).toBe('loose');
    expect(sim.remove(1)).toEqual([]);
  });
  it('removing somebody else leaves the crown alone', () => {
    const sim = started(3);
    sim.give(0);
    expect(sim.remove(2)).toEqual([]);
    expect(sim.wearer).toBe(0);
  });
  it('a disconnected wearer drops it too, and cannot pick it up while away', () => {
    const sim = started(2);
    place(sim, 0, 5, 5.5);
    sim.give(0);
    const ev = sim.setAway(0, true);
    expect(ev[0]).toMatchObject({ t: 'drop', p: 0 });
    expect(sim.setAway(0, true)).toEqual([]);
    run(sim, 1);
    expect(sim.crown.state).toBe('loose');
    expect(sim.wearer).toBe(-1);
    sim.setAway(0, false);
    run(sim, DT);
    expect(sim.wearer).toBe(0);
  });
  it('players removed before the round never take part', () => {
    const sim = new CrownSim(3, { gone: [false, true, false] });
    expect(sim.active).toBe(2);
    sim.give(1);
    expect(sim.wearer).toBe(-1);
  });
});

it('has a three-line how-to and place names', () => {
  expect(howTo(false)).toHaveLength(3);
  expect(howTo(true)).toHaveLength(3);
  expect(howTo(true)[2]).toMatch(/One round/);
  expect(howTo(false)[2]).toMatch(/Two rounds/);
  expect(ROUNDS).toBe(2);
  expect(ROUNDS_SHORT).toBe(1);
  expect(placeText(1)).toBe('1st');
  expect(placeText(5)).toBe('5th');
});
