import { describe, expect, it } from 'vitest';
import {
  CARRY_SLOW,
  ChickSim,
  DOOR_R,
  DT,
  GOLD_PTS,
  GRAB_R,
  HALF_D,
  HALF_W,
  MAX_CARRY,
  OBSTACLES,
  ROUND_S,
  RUSH_S,
  SHOVE_CD,
  WALK,
  coopsFor,
  howTo,
  minHens,
  placeText,
  type ChickEvent,
  type ChickInput,
} from '../client/src/games/chickens/logic';
import { mulberry32 } from '../client/src/games/rng';

/** Run the sim; `input(i, sim)` gives player i's input each step. */
function run(sim: ChickSim, seconds: number, input: (i: number, sim: ChickSim) => ChickInput | undefined = () => undefined, live = true) {
  const all: ChickEvent[] = [];
  for (let k = 0; k < Math.round(seconds / DT); k++) all.push(...sim.step(sim.players.map((_, i) => input(i, sim)), live));
  return all;
}

/** One step with these inputs. */
const step = (sim: ChickSim, inputs: (ChickInput | undefined)[]) => sim.step(inputs);

/** A sim with no hens and no spawning, players parked where we say. */
function bare(n: number, at: [number, number][] = []) {
  const sim = new ChickSim(n, { rng: mulberry32(7), spawn: false });
  at.forEach(([x, z], i) => {
    sim.players[i].x = x;
    sim.players[i].z = z;
  });
  return sim;
}

/** Pin a hen in place (no fleeing) by putting it right next to the player and grabbing at once. */
function grabNow(sim: ChickSim, i: number, kind: 'white' | 'brown' | 'gold' = 'white') {
  const p = sim.players[i];
  const h = sim.addHen(kind, p.x + 0.9, p.z);
  const inputs: ChickInput[] = sim.players.map(() => ({ x: 0, z: 0 }));
  inputs[i] = { x: 0, z: 0, grab: true };
  const ev = step(sim, inputs);
  return { h, ev };
}

describe('the yard', () => {
  it('has a coop for every player, each on the fence with its door facing in', () => {
    for (let n = 1; n <= 8; n++) {
      const coops = coopsFor(n);
      expect(coops).toHaveLength(n);
      for (const c of coops) {
        // The door point is inside the yard, the coop outside.
        expect(Math.abs(c.dx)).toBeLessThan(HALF_W);
        expect(Math.abs(c.dz)).toBeLessThan(HALF_D);
        expect(Math.abs(c.x) > HALF_W || Math.abs(c.z) > HALF_D).toBe(true);
        expect(Math.hypot(c.nx, c.nz)).toBeCloseTo(1);
        // Doors are well apart.
        for (const o of coops) if (o !== c) expect(Math.hypot(o.dx - c.dx, o.dz - c.dz)).toBeGreaterThan(5);
        // And clear of the props.
        for (const o of OBSTACLES) expect(Math.hypot(o.x - c.dx, o.z - c.dz)).toBeGreaterThan(o.r + DOOR_R);
      }
    }
  });
  it('starts everyone in front of their own coop, inside the fence', () => {
    const sim = new ChickSim(8, { rng: mulberry32(1) });
    sim.players.forEach((p, i) => {
      const c = sim.coops[i];
      expect(Math.hypot(p.x - c.dx, p.z - c.dz)).toBeGreaterThan(DOOR_R);
      expect(Math.hypot(p.x - c.dx, p.z - c.dz)).toBeLessThan(4);
      expect(Math.abs(p.x)).toBeLessThan(HALF_W);
      expect(Math.abs(p.z)).toBeLessThan(HALF_D);
    });
  });
  it('keeps players inside the fence and out of the well', () => {
    const sim = bare(1, [[0, 0]]);
    run(sim, 6, () => ({ x: -1, z: 0 }));
    expect(sim.players[0].x).toBeGreaterThanOrEqual(-HALF_W);
    const w = OBSTACLES[0];
    const s2 = bare(1, [[w.x + 4, w.z]]);
    run(s2, 2, () => ({ x: -1, z: 0 }));
    expect(Math.hypot(s2.players[0].x - w.x, s2.players[0].z - w.z)).toBeGreaterThanOrEqual(w.r + 0.69);
  });
});

describe('grabbing', () => {
  it('picks up a hen within reach', () => {
    const sim = bare(2, [
      [0, 0],
      [8, 0],
    ]);
    const { h, ev } = grabNow(sim, 0);
    expect(ev).toContainEqual({ t: 'grab', p: 0, hen: h.id, kind: 'white' });
    expect(h.state).toBe('carried');
    expect(h.carrier).toBe(0);
    expect(sim.players[0].carry).toEqual([h.id]);
  });
  it('does not reach hens further than GRAB_R', () => {
    const sim = bare(1, [[0, 0]]);
    const h = sim.addHen('white', GRAB_R + 0.4, 0);
    const ev = run(sim, 0.3, (_, s) => (s.time < DT * 1.5 ? { x: 0, z: 0, grab: true } : { x: 0, z: 0 }));
    expect(ev.some((e) => e.t === 'grab')).toBe(false);
    expect(ev.some((e) => e.t === 'miss')).toBe(true);
    expect(h.state).toBe('roam');
  });
  it('picks the nearest hen in reach', () => {
    const sim = bare(1, [[0, 0]]);
    sim.addHen('brown', 1.5, 0);
    const near = sim.addHen('white', 0, 0.9);
    step(sim, [{ x: 0, z: 0, grab: true }]);
    expect(sim.players[0].carry).toEqual([near.id]);
  });
  it('stacks up to three hens, then says the head is full', () => {
    const sim = bare(1, [[0, 0]]);
    for (let k = 0; k < MAX_CARRY; k++) grabNow(sim, 0);
    expect(sim.players[0].carry).toHaveLength(MAX_CARRY);
    expect(sim.players[0].carry.map((id) => sim.hen(id)!.slot)).toEqual([0, 1, 2]);
    const { h, ev } = grabNow(sim, 0);
    expect(ev).toContainEqual({ t: 'miss', p: 0, full: true });
    expect(h.state).not.toBe('carried');
    expect(sim.players[0].carry).toHaveLength(MAX_CARRY);
  });
  it('slows you down a little for every hen', () => {
    const speedWith = (k: number) => {
      const sim = bare(1, [[-10, 0]]);
      for (let j = 0; j < k; j++) grabNow(sim, 0);
      run(sim, 1, () => ({ x: 1, z: 0 }));
      return sim.players[0].vx;
    };
    expect(speedWith(0)).toBeCloseTo(WALK);
    expect(speedWith(1)).toBeCloseTo(WALK * (1 - CARRY_SLOW));
    expect(speedWith(3)).toBeCloseTo(WALK * (1 - 3 * CARRY_SLOW));
    expect(speedWith(3)).toBeLessThan(speedWith(1));
  });
  it('carries the hens along on your head', () => {
    const sim = bare(1, [[-10, 0]]);
    const { h } = grabNow(sim, 0);
    run(sim, 0.5, () => ({ x: 1, z: 0 }));
    expect(h.x).toBeCloseTo(sim.players[0].x);
    expect(h.y).toBeGreaterThan(0.9);
  });
  it('remembers a press for a moment, so a hen walking into reach is caught', () => {
    const sim = bare(1, [[0, 0]]);
    step(sim, [{ x: 0, z: 0, grab: true }]);
    sim.addHen('white', 0.9, 0);
    step(sim, [{ x: 0, z: 0 }]);
    expect(sim.players[0].carry).toHaveLength(1);
  });
  it('makes hens run from players that come close', () => {
    const sim = bare(1, [[0, 0]]);
    const h = sim.addHen('white', 2, 0);
    run(sim, 0.5, () => ({ x: 0, z: 0 }));
    expect(h.fleeing).toBe(true);
    expect(h.x).toBeGreaterThan(2.5);
  });
});

describe('delivering', () => {
  it('scores when you walk into your own doorway', () => {
    const sim = bare(2);
    const c = sim.coops[0];
    sim.players[0].x = c.dx + c.nx * 3;
    sim.players[0].z = c.dz + c.nz * 3;
    grabNow(sim, 0);
    grabNow(sim, 0, 'brown');
    const ev = run(sim, 1.5, () => ({ x: -c.nx, z: -c.nz }));
    const d = ev.find((e) => e.t === 'deliver');
    expect(d).toMatchObject({ t: 'deliver', p: 0, pts: 2, kinds: ['white', 'brown'] });
    expect(sim.points[0]).toBe(2);
    expect(sim.delivered[0]).toBe(2);
    expect(sim.players[0].carry).toEqual([]);
    expect(sim.hens).toHaveLength(0);
  });
  it('does nothing at someone else’s coop', () => {
    const sim = bare(2);
    const other = sim.coops[1];
    sim.players[0].x = other.dx + other.nx * 3;
    sim.players[0].z = other.dz + other.nz * 3;
    sim.players[1].x = 0;
    sim.players[1].z = 0;
    grabNow(sim, 0);
    const ev = run(sim, 1.5, (i) => (i === 0 ? { x: -other.nx, z: -other.nz } : undefined));
    expect(ev.some((e) => e.t === 'deliver')).toBe(false);
    expect(Math.hypot(sim.players[0].x - other.dx, sim.players[0].z - other.dz)).toBeLessThan(DOOR_R);
    expect(sim.points).toEqual([0, 0]);
    expect(sim.players[0].carry).toHaveLength(1);
  });
  it('counts the golden hen three times', () => {
    const sim = bare(1);
    const c = sim.coops[0];
    grabNow(sim, 0, 'gold');
    grabNow(sim, 0);
    run(sim, 2, () => ({ x: -c.nx, z: -c.nz }));
    expect(sim.points[0]).toBe(GOLD_PTS + 1);
    expect(sim.delivered[0]).toBe(2);
  });
  it('does not score with empty hands, after the whistle or before the go', () => {
    const sim = bare(1);
    const c = sim.coops[0];
    expect(run(sim, 1.5, () => ({ x: -c.nx, z: -c.nz })).some((e) => e.t === 'deliver')).toBe(false);
    const s2 = bare(1);
    grabNow(s2, 0);
    expect(run(s2, 1.5, () => ({ x: -c.nx, z: -c.nz }), false).some((e) => e.t === 'deliver')).toBe(false);
    expect(s2.points[0]).toBe(0);
  });
});

describe('shoving', () => {
  const pair = () => {
    const sim = bare(2, [
      [0, 0],
      [1.6, 0],
    ]);
    sim.players[0].fx = 1;
    sim.players[0].fz = 0;
    return sim;
  };
  it('makes a carrier drop all their hens, which scatter and can’t be grabbed straight away', () => {
    const sim = pair();
    grabNow(sim, 1);
    grabNow(sim, 1);
    const carried = sim.players[1].carry.slice();
    const ev = step(sim, [{ x: 0, z: 0, shove: true }, { x: 0, z: 0 }]);
    expect(ev).toContainEqual({ t: 'lunge', p: 0 });
    const s = ev.find((e) => e.t === 'shove');
    expect(s).toEqual({ t: 'shove', p: 1, by: 0, dropped: carried });
    expect(sim.players[1].carry).toEqual([]);
    for (const id of carried) {
      const h = sim.hen(id)!;
      expect(h.state).toBe('air');
      expect(h.carrier).toBe(-1);
      expect(sim.reachable(0)?.id).not.toBe(id);
    }
    // They land again after a moment and can be picked up.
    const later = run(sim, 1.3);
    expect(later.filter((e) => e.t === 'land').length).toBeGreaterThanOrEqual(carried.length);
    for (const id of carried) expect(sim.hen(id)!.state).toBe('roam');
  });
  it('knocks the victim back and stuns them briefly', () => {
    const sim = pair();
    step(sim, [{ x: 0, z: 0, shove: true }, { x: 0, z: 0 }]);
    const v = sim.players[1];
    expect(v.stun).toBeGreaterThan(0);
    expect(v.vx).toBeGreaterThan(5);
    // Stunned players can't grab.
    sim.addHen('white', v.x, v.z + 0.9);
    step(sim, [{ x: 0, z: 0 }, { x: 0, z: 0, grab: true }]);
    expect(v.carry).toHaveLength(0);
    run(sim, 1.5);
    expect(v.stun).toBe(0);
  });
  it('cools down before the next shove', () => {
    const sim = pair();
    let lunges = 0;
    const ev = run(sim, SHOVE_CD + 0.3, (i) => (i === 0 ? { x: 0, z: 0, shove: true } : undefined));
    lunges = ev.filter((e) => e.t === 'lunge').length;
    expect(lunges).toBe(2);
  });
  it('misses players out of reach', () => {
    const sim = bare(2, [
      [0, 0],
      [0, 6],
    ]);
    sim.players[0].fx = 1;
    sim.players[0].fz = 0;
    const ev = run(sim, 0.5, (i) => (i === 0 && sim.time < DT * 1.5 ? { x: 0, z: 0, shove: true } : undefined));
    expect(ev.some((e) => e.t === 'shove')).toBe(false);
    expect(sim.players[0].x).toBeGreaterThan(2);
  });
});

describe('spawning', () => {
  it('fills the yard at the start, with at most one golden hen', () => {
    for (let seed = 1; seed < 30; seed++) {
      const sim = new ChickSim(4, { rng: mulberry32(seed) });
      expect(sim.hens).toHaveLength(minHens(4));
      expect(sim.hens.filter((h) => h.kind === 'gold').length).toBeLessThanOrEqual(1);
    }
  });
  it('sends new hens through the gate to keep the yard at its minimum', () => {
    const sim = new ChickSim(2, { rng: mulberry32(3) });
    const target = minHens(2);
    // Carry three hens away: the yard is short, and new hens come in.
    sim.hens.slice(0, 3).forEach((h) => {
      h.state = 'carried';
      h.carrier = 0;
    });
    expect(sim.freeHens).toBe(target - 3);
    const ev = run(sim, 3);
    const spawned = ev.filter((e) => e.t === 'spawn');
    expect(spawned).toHaveLength(3);
    expect(sim.freeHens).toBe(target);
    // They come in at the front gate.
    for (const s of spawned) if (s.t === 'spawn') expect(sim.hen(s.hen)!.z).toBeGreaterThan(HALF_D - 4);
  });
  it('keeps up as hens are delivered all round', () => {
    const sim = new ChickSim(3, { rng: mulberry32(9) });
    for (let k = 0; k < 4; k++) {
      sim.hens.splice(0, 2);
      run(sim, 2);
      expect(sim.freeHens).toBeGreaterThanOrEqual(minHens(3));
    }
  });
  it('wants more hens for more players', () => {
    expect(minHens(1)).toBeLessThan(minHens(4));
    expect(minHens(4)).toBeLessThan(minHens(8));
  });
  it('lets the hens wander but never out of the yard', () => {
    const sim = new ChickSim(4, { rng: mulberry32(5) });
    run(sim, 20, (i, s) => ({ x: Math.sin(s.time + i), z: Math.cos(s.time * 0.7 + i * 2) }));
    for (const h of sim.hens) {
      if (h.state === 'enter') continue;
      expect(Math.abs(h.x)).toBeLessThanOrEqual(HALF_W);
      expect(Math.abs(h.z)).toBeLessThanOrEqual(HALF_D);
    }
  });
});

describe('the clock and the scores', () => {
  it('runs for ROUND_S seconds, with a rush for the last ten', () => {
    const sim = new ChickSim(2, { rng: mulberry32(2) });
    const ev = run(sim, ROUND_S - RUSH_S - 0.5);
    expect(ev.some((e) => e.t === 'rush')).toBe(false);
    expect(sim.rush).toBe(false);
    const ev2 = run(sim, 1);
    expect(ev2.filter((e) => e.t === 'rush')).toHaveLength(1);
    expect(sim.rush).toBe(true);
    const ev3 = run(sim, RUSH_S);
    expect(ev3.filter((e) => e.t === 'over')).toHaveLength(1);
    expect(sim.done).toBe(true);
    expect(sim.left).toBe(0);
  });
  it('stops the clock when not live, and stops scoring once over', () => {
    const sim = bare(1, [[0, 0]]);
    run(sim, 2, () => undefined, false);
    expect(sim.time).toBe(0);
    const s2 = new ChickSim(1, { rng: mulberry32(1), spawn: false, length: 1 });
    run(s2, 1.2);
    expect(s2.done).toBe(true);
    const c = s2.coops[0];
    s2.players[0].carry = [s2.addHen('white', 0, 0, 'carried').id];
    run(s2, 2, () => ({ x: -c.nx, z: -c.nz }));
    expect(s2.points[0]).toBe(0);
  });
  it('makes the hens faster in the rush', () => {
    const flee = (rush: boolean) => {
      const sim = bare(1, [[0, 0]]);
      sim.rush = rush;
      const h = sim.addHen('white', 1.2, 0);
      h.jit = 0;
      run(sim, 0.4, () => undefined, false);
      return h.x;
    };
    expect(flee(true)).toBeGreaterThan(flee(false));
  });
  it('ranks by points, ties keep join order, and works solo', () => {
    const sim = bare(3);
    sim.points.splice(0, 3, 2, 5, 2);
    expect(sim.ranking()).toEqual([1, 0, 2]);
    const solo = new ChickSim(1, { rng: mulberry32(4) });
    expect(solo.solo).toBe(true);
    expect(solo.ranking()).toEqual([0]);
    expect(placeText(1)).toBe('1st');
    expect(placeText(5)).toBe('5th');
  });
});

describe('removal', () => {
  it('frees the hens a leaving player carried', () => {
    const sim = bare(2, [
      [0, 0],
      [6, 0],
    ]);
    grabNow(sim, 0);
    grabNow(sim, 0, 'gold');
    const ids = sim.players[0].carry.slice();
    sim.remove(0);
    expect(sim.players[0].gone).toBe(true);
    expect(sim.players[0].carry).toEqual([]);
    for (const id of ids) {
      expect(sim.hen(id)!.state).toBe('air');
      expect(sim.hen(id)!.carrier).toBe(-1);
    }
    run(sim, 2);
    for (const id of ids) expect(sim.hen(id)!.state).toBe('roam');
    expect(sim.ranking()).toEqual([1]);
  });
  it('ignores a removed player from then on', () => {
    const sim = bare(2, [
      [0, 0],
      [1.6, 0],
    ]);
    sim.remove(1);
    sim.remove(1);
    const ev = step(sim, [{ x: 0, z: 0, shove: true }, { x: -1, z: 0, grab: true, shove: true }]);
    expect(ev.some((e) => e.t === 'shove')).toBe(false);
    expect(sim.players[1].x).toBe(1.6);
  });
  it('starts later rounds without the players who left', () => {
    const sim = new ChickSim(3, { rng: mulberry32(1), gone: [false, true, false] });
    expect(sim.players[1].gone).toBe(true);
    expect(sim.target).toBe(minHens(2));
    expect(sim.ranking()).toEqual([0, 2]);
  });
});

describe('howTo', () => {
  it('has three short lines for both versions', () => {
    for (const s of [false, true]) {
      const lines = howTo(s);
      expect(lines).toHaveLength(3);
      for (const l of lines) expect(l.length).toBeLessThan(48);
    }
    expect(howTo(true)).not.toEqual(howTo(false));
  });
});
