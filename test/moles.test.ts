import { describe, expect, it } from 'vitest';
import {
  ARC,
  DT,
  HEDGEHOG_AFTER,
  MolesSim,
  OUCH,
  POINTS,
  REACH,
  RISE,
  ROUND_S,
  SINK,
  STUN,
  UP_END,
  UP_START,
  WHACK_CD,
  gridFor,
  howTo,
  kindFor,
  maxUp,
  popGap,
  upTime,
  type MolesEvent,
  type MolesInput,
} from '../client/src/games/moles/logic';
import { mulberry32 } from '../client/src/games/rng';

/** Run the sim for `seconds`; `inp(i, sim)` gives player i's input each step. */
function run(sim: MolesSim, seconds: number, inp: (i: number, sim: MolesSim) => MolesInput | undefined = () => undefined) {
  const all: MolesEvent[] = [];
  for (let k = 0; k < Math.round(seconds / DT); k++) all.push(...sim.step(sim.players.map((_, i) => inp(i, sim))));
  return all;
}

/** A sim with no random pops, started, and player 0 standing at (x, z) facing (fx, fz). */
function manual(n = 1, at: [number, number] = [0, 0], face: [number, number] = [0, -1]) {
  const sim = new MolesSim(n, { rng: mulberry32(1), auto: false });
  sim.begin();
  const p = sim.players[0];
  [p.x, p.z] = at;
  [p.fx, p.fz] = face;
  return sim;
}

/** Stand player 0 next to hole h (just south of it, facing it). */
function nextTo(sim: MolesSim, h: number, i = 0, gap = 0.9) {
  const p = sim.players[i];
  p.x = sim.holes[h].x;
  p.z = sim.holes[h].z + gap;
  p.fx = 0;
  p.fz = -1;
}

/** Let a fresh critter rise far enough to be whackable. */
const rise = (sim: MolesSim) => run(sim, RISE);

/** Press Whack for player i on one step (others idle). */
function whack(sim: MolesSim, i = 0) {
  return sim.step(sim.players.map((_, k) => (k === i ? { x: 0, z: 0, whack: true } : undefined)));
}

describe('the garden', () => {
  it('has about a 4×4 grid of molehills, more with more players', () => {
    expect(gridFor(1)).toEqual({ cols: 4, rows: 4 });
    expect(gridFor(4)).toEqual({ cols: 4, rows: 4 });
    const six = gridFor(6);
    const eight = gridFor(8);
    expect(six.cols * six.rows).toBeGreaterThan(16);
    expect(eight.cols * eight.rows).toBeGreaterThanOrEqual(six.cols * six.rows);
    expect(new MolesSim(2).holes).toHaveLength(16);
    expect(new MolesSim(8).holes).toHaveLength(25);
  });
  it('keeps the holes apart and inside the garden, and the players start inside it too', () => {
    const sim = new MolesSim(8, { rng: mulberry32(5) });
    for (const [a, h] of sim.holes.entries()) {
      expect(Math.abs(h.x)).toBeLessThan(sim.W / 2);
      expect(Math.abs(h.z)).toBeLessThan(sim.H / 2);
      for (const g of sim.holes.slice(a + 1)) expect(Math.hypot(h.x - g.x, h.z - g.z)).toBeGreaterThan(2);
    }
    for (const p of sim.players) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(sim.W / 2);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(sim.H / 2);
    }
  });
  it('is the same garden every round with the same layout seed', () => {
    expect(new MolesSim(3, { layout: 42 }).holes).toEqual(new MolesSim(3, { layout: 42 }).holes);
  });
  it('has three short how-to lines', () => {
    expect(howTo(false)).toHaveLength(3);
    expect(howTo(true)).toHaveLength(3);
    expect(howTo(true)[2]).toContain('45');
  });
});

describe('the pop schedule', () => {
  it('shortens the up-time from 1.3 s to 0.8 s over the round', () => {
    expect(upTime(0)).toBeCloseTo(UP_START);
    expect(UP_START).toBeCloseTo(1.3);
    expect(UP_END).toBeCloseTo(0.8);
    expect(upTime(ROUND_S)).toBeCloseTo(UP_END);
    expect(upTime(ROUND_S * 2)).toBeCloseTo(UP_END);
    for (let t = 1; t <= ROUND_S; t++) expect(upTime(t)).toBeLessThan(upTime(t - 1));
  });
  it('lets more critters up at once, and pops them faster, as the round goes on and with more players', () => {
    expect(maxUp(ROUND_S, 2, 16)).toBeGreaterThan(maxUp(0, 2, 16));
    expect(maxUp(0, 8, 25)).toBeGreaterThan(maxUp(0, 1, 16));
    expect(maxUp(ROUND_S, 8, 25)).toBeLessThanOrEqual(23);
    expect(popGap(ROUND_S, 2)).toBeLessThan(popGap(0, 2));
    expect(popGap(0, 8)).toBeLessThan(popGap(0, 1));
  });
  it('sends gold now and then, and hedgehogs only after the first seconds', () => {
    expect(kindFor(0, 0.01)).toBe('gold');
    expect(kindFor(1, 0.99)).toBe('mole');
    expect(kindFor(HEDGEHOG_AFTER + 1, 0.99)).toBe('hedgehog');
    expect(kindFor(20, 0.5)).toBe('mole');
  });
  it('pops critters through a round, more up at once later on, each up for its ramped time', () => {
    const sim = new MolesSim(4, { rng: mulberry32(9) });
    sim.begin();
    const pops: { t: number; up: number; kind: string }[] = [];
    let earlyMax = 0;
    let lateMax = 0;
    for (let k = 0; k < Math.round(ROUND_S / DT); k++) {
      for (const e of sim.step([])) if (e.t === 'pop') pops.push({ t: sim.time, up: e.c.up, kind: e.c.kind });
      const upNow = sim.critters.filter((c) => c.by < 0).length;
      expect(upNow).toBeLessThanOrEqual(maxUp(sim.time, 4, 16));
      if (sim.time < 10) earlyMax = Math.max(earlyMax, upNow);
      if (sim.time > 35) lateMax = Math.max(lateMax, upNow);
      // Never two critters in one hole.
      const holes = sim.critters.map((c) => c.hole);
      expect(new Set(holes).size).toBe(holes.length);
    }
    expect(pops.length).toBeGreaterThan(40);
    expect(lateMax).toBeGreaterThan(earlyMax);
    const moles = pops.filter((p) => p.kind !== 'hedgehog');
    expect(moles[0].up).toBeGreaterThan(1.2);
    expect(moles[moles.length - 1].up).toBeLessThan(0.9);
    expect(pops.filter((p) => p.kind === 'hedgehog').every((p) => p.t >= HEDGEHOG_AFTER)).toBe(true);
    expect(new Set(pops.map((p) => p.kind))).toEqual(new Set(['mole', 'gold', 'hedgehog']));
  });
  it('rises, stays up, ducks and goes', () => {
    const sim = manual();
    const c = sim.pop(0, 'mole', 1)!;
    expect(sim.pop(0, 'mole')).toBeNull();
    const ev = run(sim, RISE + 1 + SINK + 0.05);
    expect(ev.some((e) => e.t === 'duck' && e.c.id === c.id)).toBe(true);
    expect(ev.some((e) => e.t === 'gone' && e.id === c.id)).toBe(true);
    expect(sim.critters).toHaveLength(0);
  });
  it('pops nothing before the round begins', () => {
    const sim = new MolesSim(3, { rng: mulberry32(2) });
    expect(run(sim, 3).filter((e) => e.t === 'pop')).toHaveLength(0);
    expect(sim.time).toBe(0);
  });
});

describe('whacking', () => {
  it('hits a mole in front within reach for +1, and it sees stars before ducking', () => {
    const sim = manual();
    nextTo(sim, 5);
    const c = sim.pop(5, 'mole')!;
    rise(sim);
    const ev = whack(sim);
    const hit = ev.find((e) => e.t === 'hit');
    expect(hit).toMatchObject({ p: 0, kind: 'mole', pts: 1 });
    expect(sim.points[0]).toBe(1);
    expect(c.by).toBe(0);
    expect(sim.whackable(c)).toBe(false);
    expect(sim.players[0].moles).toBe(1);
  });
  it('misses a mole out of reach', () => {
    const sim = manual();
    nextTo(sim, 5, 0, REACH + 0.9);
    sim.pop(5, 'mole');
    rise(sim);
    const ev = whack(sim);
    expect(ev.some((e) => e.t === 'hit')).toBe(false);
    expect(ev.some((e) => e.t === 'miss')).toBe(true);
    expect(sim.points[0]).toBe(0);
  });
  it('only hits inside the arc in front, not behind or far to the side', () => {
    const sim = manual();
    const h = sim.holes[5];
    const p = sim.players[0];
    const inArc = (ang: number) => {
      p.x = h.x - Math.sin(ang) * 1;
      p.z = h.z + Math.cos(ang) * 1;
      p.fx = 0;
      p.fz = -1;
      return sim.inSwing(0, h.x, h.z);
    };
    expect(inArc(0)).toBe(true);
    expect(inArc(ARC / 2 - 0.05)).toBe(true);
    expect(inArc(-(ARC / 2 - 0.05))).toBe(true);
    expect(inArc(ARC / 2 + 0.15)).toBe(false);
    expect(inArc(Math.PI)).toBe(false);
    // Right on top of the hole, any facing finds it.
    p.x = h.x + 0.2;
    p.z = h.z;
    p.fx = 1;
    p.fz = 0;
    expect(sim.inSwing(0, h.x, h.z)).toBe(true);
  });
  it('whacks the nearest critter when two are in the swing, one per swing', () => {
    const sim = new MolesSim(1, { auto: false, cols: 2, rows: 1, rng: () => 0.5 });
    sim.begin();
    const [a, b] = sim.holes;
    const p = sim.players[0];
    p.x = a.x + 1.2;
    p.z = a.z;
    p.fx = 1;
    p.fz = 0;
    // Put the second hole close enough to be in reach too, but further away.
    b.x = p.x + 1.3;
    sim.pop(0, 'mole');
    const cb = sim.pop(1, 'gold')!;
    rise(sim);
    p.fx = 1;
    p.fz = 0;
    const ev = whack(sim);
    expect(ev.filter((e) => e.t === 'hit')).toHaveLength(1);
    expect(ev.find((e) => e.t === 'hit')).toMatchObject({ c: cb, kind: 'gold' });
  });
  it('can’t hit a critter that has barely started rising or has sunk back', () => {
    const sim = manual();
    nextTo(sim, 3);
    sim.pop(3, 'mole', 0.5);
    expect(whack(sim).some((e) => e.t === 'hit')).toBe(false);
    run(sim, RISE + 0.5 + SINK);
    sim.players[0].cd = 0;
    expect(whack(sim).some((e) => e.t === 'hit')).toBe(false);
  });
});

describe('scoring', () => {
  const score = (kinds: ('mole' | 'gold' | 'hedgehog')[]) => {
    const sim = manual();
    nextTo(sim, 6);
    for (const k of kinds) {
      sim.pop(6, k);
      rise(sim);
      whack(sim);
      run(sim, 1.2);
    }
    return sim;
  };
  it('scores +1 a mole, +3 a golden mole and −2 a hedgehog', () => {
    expect(POINTS).toEqual({ mole: 1, gold: 3, hedgehog: -2 });
    expect(score(['mole']).points[0]).toBe(1);
    expect(score(['gold']).points[0]).toBe(3);
    expect(score(['gold', 'mole', 'hedgehog']).points[0]).toBe(2);
    const s = score(['mole', 'gold', 'gold', 'hedgehog']);
    expect(s.players[0]).toMatchObject({ moles: 1, golds: 2, hedgehogs: 1 });
  });
  it('never takes a round below 0', () => {
    const s = score(['hedgehog']);
    expect(s.points[0]).toBe(0);
    const t = score(['mole', 'hedgehog', 'hedgehog', 'gold']);
    expect(t.points[0]).toBe(3);
  });
  it('reports only what the hedgehog could take', () => {
    const sim = manual();
    nextTo(sim, 6);
    sim.pop(6, 'mole');
    rise(sim);
    whack(sim);
    run(sim, 1.2);
    sim.pop(6, 'hedgehog');
    rise(sim);
    const hit = whack(sim).find((e) => e.t === 'hit');
    expect(hit).toMatchObject({ kind: 'hedgehog', pts: -1 });
    expect(sim.points[0]).toBe(0);
  });
  it('makes you hop about holding your hand after a hedgehog: slow, and no whacking', () => {
    const sim = manual();
    nextTo(sim, 6);
    sim.pop(6, 'hedgehog');
    rise(sim);
    whack(sim);
    expect(sim.players[0].ouch).toBeGreaterThan(0);
    sim.pop(2, 'mole');
    nextTo(sim, 2);
    rise(sim);
    sim.players[0].cd = 0;
    expect(whack(sim).some((e) => e.t === 'swing')).toBe(false);
    run(sim, OUCH);
    expect(sim.players[0].ouch).toBe(0);
    // The press got eaten, and now it works again.
    sim.pop(9, 'mole');
    nextTo(sim, 9);
    rise(sim);
    expect(whack(sim).some((e) => e.t === 'hit')).toBe(true);
  });
  it('ranks players and finds the round winners (nobody wins with 0)', () => {
    const sim = new MolesSim(3, { auto: false });
    expect(sim.results().winners).toEqual([]);
    sim.points[1] = 4;
    sim.points[2] = 4;
    sim.points[0] = 1;
    expect(sim.ranking()).toEqual([1, 2, 0]);
    expect(sim.results().winners).toEqual([1, 2]);
  });
});

describe('the spoon’s cooldown', () => {
  it('can’t swing again for 0.45 s', () => {
    const sim = manual();
    const swings = () => run(sim, 2, () => ({ x: 0, z: 0, whack: true })).filter((e) => e.t === 'swing').length;
    expect(WHACK_CD).toBeCloseTo(0.45);
    const n = swings();
    expect(n).toBeLessThanOrEqual(Math.ceil(2 / WHACK_CD) + 1);
    expect(n).toBeGreaterThanOrEqual(Math.floor(2 / WHACK_CD) - 1);
  });
  it('remembers a press made just before the spoon is back', () => {
    const sim = manual();
    whack(sim);
    run(sim, WHACK_CD - 0.1);
    const ev = whack(sim);
    expect(ev.some((e) => e.t === 'swing')).toBe(false);
    const later = run(sim, 0.12);
    expect(later.some((e) => e.t === 'swing')).toBe(true);
  });
  it('does nothing before the round begins', () => {
    const sim = new MolesSim(1, { auto: false });
    expect(whack(sim).some((e) => e.t === 'swing')).toBe(false);
  });
});

describe('bonking other players', () => {
  it('stuns a player in the swing for 1 s, with no points for anyone', () => {
    const sim = manual(2);
    const [a, b] = sim.players;
    a.x = 0;
    a.z = 0;
    a.fx = 1;
    a.fz = 0;
    b.x = 1.25;
    b.z = 0;
    const ev = whack(sim);
    expect(ev.find((e) => e.t === 'bonk')).toMatchObject({ p: 1, by: 0 });
    expect(b.stun).toBeCloseTo(STUN, 1);
    expect(sim.points).toEqual([0, 0]);
    expect(a.bonks).toBe(1);
    // Stunned: can't walk or whack.
    const before = { x: b.x, z: b.z };
    run(sim, 0.3);
    const moved = run(sim, 0.4, (i) => (i === 1 ? { x: 1, z: 0, whack: true } : undefined));
    expect(moved.some((e) => e.t === 'swing' && e.p === 1)).toBe(false);
    expect(Math.hypot(b.x - before.x, b.z - before.z)).toBeLessThan(1.2);
    run(sim, STUN);
    expect(b.stun).toBe(0);
    const x0 = b.x;
    run(sim, 0.5, (i) => (i === 1 ? { x: -1, z: 0 } : undefined));
    expect(b.x).toBeLessThan(x0 - 1);
  });
  it('doesn’t bonk a player behind you, or one already seeing stars', () => {
    const sim = manual(3);
    const [a, b, c] = sim.players;
    a.x = 0;
    a.z = 0;
    a.fx = 1;
    a.fz = 0;
    b.x = -1.25;
    b.z = 0;
    c.x = 1.25;
    c.z = 0.3;
    c.stun = 0.5;
    expect(whack(sim).some((e) => e.t === 'bonk')).toBe(false);
  });
});

describe('the round', () => {
  it('ends when the timer runs out, clearing the garden', () => {
    const sim = new MolesSim(2, { rng: mulberry32(4), length: 5 });
    sim.begin();
    const ev = run(sim, 5.2);
    expect(ev.filter((e) => e.t === 'over')).toHaveLength(1);
    expect(sim.over).toBe(true);
    expect(sim.critters).toHaveLength(0);
    expect(sim.left).toBe(0);
    expect(sim.step([])).toEqual([]);
  });
  it('is 45 s long by default', () => {
    const sim = new MolesSim(1);
    expect(sim.length).toBe(ROUND_S);
    expect(ROUND_S).toBe(45);
  });
  it('works solo', () => {
    const sim = new MolesSim(1, { rng: mulberry32(7) });
    sim.begin();
    // A greedy bot: walk to the nearest critter that's up and whack it.
    let got = 0;
    for (let k = 0; k < Math.round(ROUND_S / DT) + 10; k++) {
      const p = sim.players[0];
      const target = sim.critters.filter((c) => sim.whackable(c) && c.kind !== 'hedgehog').sort((u, v) => dist(u.hole) - dist(v.hole))[0];
      function dist(h: number) {
        return Math.hypot(sim.holes[h].x - p.x, sim.holes[h].z - p.z);
      }
      let inp: MolesInput = { x: 0, z: 0 };
      if (target) {
        const h = sim.holes[target.hole];
        const dx = h.x - p.x;
        const dz = h.z - p.z;
        const d = Math.hypot(dx, dz);
        inp = d > 0.8 ? { x: dx / d, z: dz / d } : { x: dx / d / 5, z: dz / d / 5, whack: true };
      }
      for (const e of sim.step([inp])) if (e.t === 'hit') got++;
    }
    expect(sim.over).toBe(true);
    expect(got).toBeGreaterThan(5);
    expect(sim.points[0]).toBeGreaterThan(5);
    expect(sim.results().winners).toEqual([0]);
  });
  it('drops a removed player: no moving, no whacking, no bonks, out of the ranking', () => {
    const sim = manual(3);
    sim.points[2] = 5;
    sim.remove(2);
    const c = sim.players[2];
    const x = c.x;
    run(sim, 1, (i) => (i === 2 ? { x: 1, z: 0, whack: true } : undefined));
    expect(c.x).toBe(x);
    expect(sim.ranking()).not.toContain(2);
    expect(sim.results().winners).not.toContain(2);
    const a = sim.players[0];
    a.x = c.x - 1;
    a.z = c.z;
    a.fx = 1;
    a.fz = 0;
    a.cd = 0;
    expect(whack(sim).some((e) => e.t === 'bonk')).toBe(false);
  });
  it('keeps players inside the garden and apart', () => {
    const sim = manual(2);
    run(sim, 4, (i) => ({ x: i ? 1 : -1, z: 1 }));
    for (const p of sim.players) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(sim.W / 2 + 1e-9);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(sim.H / 2 + 1e-9);
    }
    const [a, b] = sim.players;
    b.x = a.x + 0.1;
    b.z = a.z;
    run(sim, 0.1);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1);
  });
});
