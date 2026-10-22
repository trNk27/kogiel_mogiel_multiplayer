import { describe, expect, it } from 'vitest';
import {
  BLACK_PTS,
  CAPTURE_U,
  DT,
  FLEE_R,
  GATE_W,
  PEN_D,
  PEN_W,
  PLAYER_R,
  ROCKS,
  ROUND_S,
  RX,
  RZ,
  SheepSim,
  WALK,
  WHISTLE_CD,
  WHISTLE_R,
  WHITE_PTS,
  blackStart,
  ellipseQ,
  finalScores,
  flockSize,
  howTo,
  minFlock,
  mulberry32,
  penLayout,
  penLocal,
  penWorld,
  placeText,
  sheepValue,
  type SheepEvent,
  type SheepInput,
} from '../client/src/games/sheep/logic';

type Driver = (i: number, sim: SheepSim) => SheepInput | undefined;

function run(sim: SheepSim, seconds: number, drive: Driver = () => undefined) {
  const all: SheepEvent[] = [];
  for (let k = 0; k < Math.round(seconds / DT); k++) all.push(...sim.step(sim.dogs.map((_, i) => drive(i, sim))));
  return all;
}

/** A dog that runs towards a point. */
const towards = (sim: SheepSim, i: number, x: number, z: number): SheepInput => {
  const d = sim.dogs[i];
  const dx = x - d.x;
  const dz = z - d.z;
  const l = Math.hypot(dx, dz);
  return l < 0.3 ? { x: 0, z: 0 } : { x: dx / l, z: dz / l };
};

const empty = (n: number, extra: object = {}) => new SheepSim(n, { rng: mulberry32(7), flock: 0, respawn: false, ...extra });

/** Park every dog far from the action, in front of its own gate. */
const idle: Driver = () => ({ x: 0, z: 0 });

describe('the meadow', () => {
  it('puts one pen per player round the fence, inside the meadow, gates facing in', () => {
    for (let n = 1; n <= 8; n++) {
      const pens = penLayout(n);
      expect(pens).toHaveLength(n);
      pens.forEach((p, i) => {
        expect(p.owner).toBe(i);
        // The gate is inside the meadow, the back wall near the fence.
        expect(ellipseQ(p.x, p.z)).toBeLessThan(0.85);
        const back = penWorld(p, PEN_D, 0);
        expect(ellipseQ(back.x, back.z)).toBeGreaterThan(0.9);
        expect(ellipseQ(back.x, back.z)).toBeLessThan(1.01);
        // The gate faces the middle: moving from the gate towards the centre lowers u.
        expect(penLocal(p, 0, 0).u).toBeLessThan(0);
        // Nobody's pen sits on the hut's gap at the top.
        expect(Math.abs(p.x) > 3 || p.z > -RZ + 5).toBe(true);
      });
      // Pens don't overlap.
      for (let a = 0; a < n; a++)
        for (let b = a + 1; b < n; b++) expect(Math.hypot(pens[a].x - pens[b].x, pens[a].z - pens[b].z)).toBeGreaterThan(PEN_W);
    }
  });

  it('sizes the flock for the room', () => {
    expect(flockSize(1)).toBe(13);
    expect(flockSize(4)).toBe(19);
    expect(flockSize(8)).toBe(26);
    expect(minFlock(8)).toBe(13);
    expect(blackStart(1)).toBe(2);
    expect(blackStart(8)).toBe(4);
    const sim = new SheepSim(4, { rng: mulberry32(1) });
    expect(sim.sheep).toHaveLength(19);
    expect(sim.sheep.filter((s) => s.black)).toHaveLength(blackStart(4));
    // The flock starts in the middle, off the rocks.
    for (const s of sim.sheep) {
      expect(ellipseQ(s.x, s.z)).toBeLessThan(0.45);
      for (const r of ROCKS) expect(Math.hypot(s.x - r.x, s.z - r.z)).toBeGreaterThan(r.r);
    }
  });

  it('starts every dog in front of its own gate', () => {
    const sim = empty(6);
    sim.dogs.forEach((d, i) => {
      const { u, v } = penLocal(sim.pens[i], d.x, d.z);
      expect(u).toBeLessThan(0);
      expect(Math.abs(v)).toBeLessThan(0.01);
    });
  });
});

describe('flocking', () => {
  it('keeps every sheep on the meadow (or in a pen) with dogs charging about', () => {
    for (const seed of [1, 2, 3]) {
      const rng = mulberry32(seed);
      const sim = new SheepSim(5, { rng: mulberry32(seed + 10) });
      const goals = sim.dogs.map(() => ({ x: 0, z: 0 }));
      run(sim, 40, (i, s) => {
        if (rng() < 0.01) goals[i] = { x: (rng() - 0.5) * 2 * RX, z: (rng() - 0.5) * 2 * RZ };
        return { ...towards(s, i, goals[i].x, goals[i].z), whistle: rng() < 0.01 };
      });
      for (const s of sim.sheep) {
        expect(Number.isFinite(s.x) && Number.isFinite(s.z)).toBe(true);
        if (s.state === 'free') expect(ellipseQ(s.x, s.z)).toBeLessThanOrEqual(1.0001);
        if (s.state === 'penned') {
          const { u, v } = penLocal(sim.pens[s.pen], s.x, s.z);
          expect(u).toBeGreaterThanOrEqual(CAPTURE_U - 1e-6);
          expect(u).toBeLessThanOrEqual(PEN_D);
          expect(Math.abs(v)).toBeLessThanOrEqual(PEN_W / 2);
        }
      }
      for (const d of sim.dogs) expect(ellipseQ(d.x, d.z)).toBeLessThanOrEqual(1.0001);
    }
  });

  it('keeps a calm flock together and grazing in the middle', () => {
    const sim = new SheepSim(2, { rng: mulberry32(4), respawn: false });
    run(sim, 30, idle);
    expect(sim.sheep.every((s) => s.state === 'free')).toBe(true);
    const cx = sim.sheep.reduce((a, s) => a + s.x, 0) / sim.sheep.length;
    const cz = sim.sheep.reduce((a, s) => a + s.z, 0) / sim.sheep.length;
    expect(ellipseQ(cx, cz)).toBeLessThan(0.5);
    // Nobody overlaps much.
    for (const a of sim.sheep) for (const b of sim.sheep) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.5);
    // Calm sheep amble; they don't run.
    for (const s of sim.sheep) expect(Math.hypot(s.vx, s.vz)).toBeLessThan(1.2);
  });

  it('runs away from a dog that comes close', () => {
    const sim = empty(1);
    const s = sim.addSheep(0, 0);
    sim.dogs[0].x = -2;
    sim.dogs[0].z = 0;
    const before = Math.hypot(s.x - sim.dogs[0].x, s.z - sim.dogs[0].z);
    const ev = run(sim, 0.6, idle);
    expect(s.x).toBeGreaterThan(0.5);
    expect(Math.hypot(s.x - sim.dogs[0].x, s.z - sim.dogs[0].z)).toBeGreaterThan(before);
    expect(s.alert).toBeGreaterThan(0.3);
    expect(ev.some((e) => e.t === 'spook' && e.id === s.id)).toBe(true);
  });

  it('ignores a dog out of range', () => {
    const sim = empty(1);
    const s = sim.addSheep(0, 0);
    s.grazing = true;
    s.graze = 10;
    sim.dogs[0].x = -(FLEE_R + 1);
    sim.dogs[0].z = 0;
    run(sim, 1, idle);
    expect(Math.hypot(s.x, s.z)).toBeLessThan(0.3);
    expect(s.alert).toBe(0);
  });

  it('scatters a whole group, not just the nearest sheep, as fear spreads', () => {
    const sim = empty(1);
    const near = sim.addSheep(0, 0);
    const far = sim.addSheep(3.5, 0);
    sim.dogs[0].x = -1.5;
    sim.dogs[0].z = 0;
    run(sim, 0.4, idle);
    expect(near.alert).toBeGreaterThan(0.4);
    // `far` is out of the dog's reach but near a running sheep.
    expect(far.alert).toBeGreaterThan(0);
  });

  it('lets dogs run faster than sheep', () => {
    expect(WALK).toBeGreaterThan(5.4);
  });
});

describe('whistle', () => {
  it('scares free sheep within the radius only, away from the whistler', () => {
    const sim = empty(1);
    sim.dogs[0].x = 0;
    sim.dogs[0].z = 0;
    const near = sim.addSheep(WHISTLE_R - 1, 0);
    const far = sim.addSheep(-(WHISTLE_R + 1.5), 0);
    const ev = sim.step([{ x: 0, z: 0, whistle: true }]);
    const w = ev.find((e) => e.t === 'whistle');
    expect(w).toMatchObject({ t: 'whistle', p: 0, scared: 1 });
    expect(near.panic).toBeGreaterThan(0);
    expect(near.vx).toBeGreaterThan(1);
    expect(far.panic).toBe(0);
    run(sim, 0.8, idle);
    expect(near.x).toBeGreaterThan(WHISTLE_R + 0.5);
  });

  it('cools down for WHISTLE_CD seconds', () => {
    const sim = empty(1);
    const count = (ev: SheepEvent[]) => ev.filter((e) => e.t === 'whistle').length;
    expect(count(sim.step([{ x: 0, z: 0, whistle: true }]))).toBe(1);
    expect(sim.dogs[0].cd).toBeCloseTo(WHISTLE_CD, 5);
    // Mashing it during the cooldown does nothing.
    let n = 0;
    for (let k = 0; k < Math.round((WHISTLE_CD - 0.5) / DT); k++) n += count(sim.step([{ x: 0, z: 0, whistle: k % 10 === 0 }]));
    expect(n).toBe(0);
    // A press just before it's ready is remembered.
    n = 0;
    for (let k = 0; k < Math.round(0.6 / DT); k++) n += count(sim.step([{ x: 0, z: 0, whistle: k === Math.round(0.4 / DT) }]));
    expect(n).toBe(1);
    expect(sim.dogs[0].whistles).toBe(2);
  });

  it("can't scare sheep out of a pen", () => {
    const sim = empty(1);
    const pen = sim.pens[0];
    const p = penWorld(pen, PEN_D * 0.6, 0);
    const s = sim.addSheep(p.x, p.z);
    sim.step([idle(0, sim)]);
    expect(s.state).toBe('penned');
    const g = penWorld(pen, -1, 0);
    sim.dogs[0].x = g.x;
    sim.dogs[0].z = g.z;
    const ev = sim.step([{ x: 0, z: 0, whistle: true }]);
    expect(ev.find((e) => e.t === 'whistle')).toMatchObject({ scared: 0 });
    run(sim, 3, idle);
    expect(s.state).toBe('penned');
    expect(pen.points).toBe(1);
  });
});

describe('pens', () => {
  /** A sheep just outside pen `k`'s gate, walking in. */
  function atGate(sim: SheepSim, k: number, black = false) {
    const pen = sim.pens[k];
    const p = penWorld(pen, -0.3, 0);
    const s = sim.addSheep(p.x, p.z, black);
    return s;
  }
  /** Keep walking these sheep into their pens (as if a dog were just behind them). */
  const walk = (sim: SheepSim, list: { s: ReturnType<SheepSim['addSheep']>; k: number }[]) => () => {
    for (const { s, k } of list)
      if (s.state === 'free') {
        s.vx = sim.pens[k].nx * 1.2;
        s.vz = sim.pens[k].nz * 1.2;
      }
    return { x: 0, z: 0 };
  };

  it('counts a sheep that walks through a gate for that pen owner, once', () => {
    const sim = empty(3);
    // Keep the dogs out of the way.
    sim.dogs.forEach((d) => ((d.x = 0), (d.z = 0)));
    const s = atGate(sim, 1);
    const ev = run(sim, 1.5, walk(sim, [{ s, k: 1 }]));
    expect(s.state).toBe('penned');
    expect(s.pen).toBe(1);
    expect(ev.filter((e) => e.t === 'pen')).toEqual([{ t: 'pen', id: s.id, pen: 1, value: WHITE_PTS, black: false, x: expect.any(Number), z: expect.any(Number) }]);
    expect(sim.scores()).toEqual([0, 1, 0]);
    // It stays, and isn't counted again.
    const later = run(sim, 10, idle);
    expect(later.filter((e) => e.t === 'pen')).toHaveLength(0);
    expect(sim.pens[1]).toMatchObject({ count: 1, points: 1 });
    const { u, v } = penLocal(sim.pens[1], s.x, s.z);
    expect(u).toBeGreaterThan(CAPTURE_U - 1e-6);
    expect(Math.abs(v)).toBeLessThan(PEN_W / 2);
    expect(sim.ranking()[0]).toBe(1);
  });

  it('is worth 3 for a black sheep', () => {
    expect(sheepValue(true)).toBe(BLACK_PTS);
    expect(sheepValue(false)).toBe(WHITE_PTS);
    const sim = empty(2);
    sim.dogs.forEach((d) => ((d.x = 0), (d.z = 0)));
    const a = atGate(sim, 0, true);
    const b = atGate(sim, 1);
    run(sim, 1.5, walk(sim, [{ s: a, k: 0 }, { s: b, k: 1 }]));
    expect(sim.scores()).toEqual([3, 1]);
    expect(sim.pens[0].black).toBe(1);
  });

  it("only lets sheep in through the gate, not through the fence", () => {
    const sim = empty(1);
    sim.dogs[0].x = sim.dogs[0].z = 0;
    const pen = sim.pens[0];
    // Beside the pen, walking sideways into its wall.
    const p = penWorld(pen, PEN_D * 0.5, -(PEN_W / 2 + 0.5));
    const s = sim.addSheep(p.x, p.z);
    run(sim, 1, () => {
      s.vx = pen.lx * 2;
      s.vz = pen.lz * 2;
      return { x: 0, z: 0 };
    });
    expect(s.state).toBe('free');
    expect(penLocal(pen, s.x, s.z).v).toBeLessThan(-PEN_W / 2);
    // Against the fence stub next to the gate.
    const q = penWorld(pen, -0.6, -(GATE_W / 2 + 0.5));
    const t = sim.addSheep(q.x, q.z);
    run(sim, 1, () => {
      t.vx = pen.nx * 2;
      t.vz = pen.nz * 2;
      return { x: 0, z: 0 };
    });
    expect(t.state).toBe('free');
  });

  it('keeps dogs out of the pens', () => {
    const sim = empty(1);
    const pen = sim.pens[0];
    run(sim, 3, () => ({ x: pen.nx, z: pen.nz }));
    const { u } = penLocal(pen, sim.dogs[0].x, sim.dogs[0].z);
    expect(u).toBeLessThanOrEqual(-PLAYER_R + 1e-6);
  });

  it('a dog can herd a sheep home', () => {
    const sim = empty(1);
    const pen = sim.pens[0];
    const start = penWorld(pen, -4, 0);
    const s = sim.addSheep(start.x, start.z);
    // The dog walks up behind the sheep, on the far side from the gate.
    const behind = penWorld(pen, -7, 0);
    sim.dogs[0].x = behind.x;
    sim.dogs[0].z = behind.z;
    run(sim, 8, (i, sm) => {
      const b = { x: s.x - pen.nx * 2.2, z: s.z - pen.nz * 2.2 };
      return s.state === 'penned' ? { x: 0, z: 0 } : towards(sm, i, b.x, b.z);
    });
    expect(s.state).toBe('penned');
    expect(sim.scores()).toEqual([1]);
  });
});

describe('the hut', () => {
  it('sends new sheep in when the flock gets small', () => {
    const sim = new SheepSim(4, { rng: mulberry32(3) });
    // Pen most of the flock by hand.
    const pen = sim.pens[0];
    for (const s of sim.sheep.slice(0, 15)) {
      const p = penWorld(pen, PEN_D * 0.6, 0);
      s.x = p.x;
      s.z = p.z;
    }
    sim.dogs.forEach((d) => ((d.x = 0), (d.z = 0)));
    sim.step([]);
    expect(sim.pens[0].count).toBe(15);
    expect(sim.freeCount).toBeLessThan(sim.minFlock);
    const ev = run(sim, 8, idle);
    expect(ev.filter((e) => e.t === 'spawn').length).toBeGreaterThan(0);
    expect(sim.freeCount).toBeGreaterThanOrEqual(sim.minFlock);
    // They walked in through the gap and are now free in the meadow.
    const newcomers = sim.sheep.filter((s) => ev.some((e) => e.t === 'spawn' && e.id === s.id));
    expect(newcomers.every((s) => s.state === 'free' && ellipseQ(s.x, s.z) <= 1)).toBe(true);
    // No more than needed.
    expect(sim.freeCount).toBeLessThanOrEqual(sim.minFlock + 1);
  });

  it('never fills the meadow past MAX_SHEEP and stops at the final whistle', () => {
    const sim = new SheepSim(1, { rng: mulberry32(5), flock: 0, length: 5 });
    run(sim, 6, idle);
    expect(sim.freeCount).toBe(minFlock(1));
    expect(sim.sheep.length).toBe(minFlock(1));
  });
});

describe('dogs', () => {
  it('bump softly off each other', () => {
    const sim = empty(2);
    sim.dogs[0].x = -2;
    sim.dogs[0].z = 0;
    sim.dogs[1].x = 2;
    sim.dogs[1].z = 0;
    const ev = run(sim, 0.6, (i) => ({ x: i === 0 ? 1 : -1, z: 0 }));
    expect(ev.some((e) => e.t === 'bump')).toBe(true);
    for (let k = 0; k < 10; k++) {
      sim.step([{ x: 1, z: 0 }, { x: -1, z: 0 }]);
      expect(Math.hypot(sim.dogs[0].x - sim.dogs[1].x, sim.dogs[0].z - sim.dogs[1].z)).toBeGreaterThan(PLAYER_R * 2 - 0.05);
    }
  });

  it('stay off the rocks', () => {
    const sim = empty(1);
    const r = ROCKS[0];
    sim.dogs[0].x = r.x - 3;
    sim.dogs[0].z = r.z;
    run(sim, 1.5, () => ({ x: 1, z: 0 }));
    expect(Math.hypot(sim.dogs[0].x - r.x, sim.dogs[0].z - r.z)).toBeGreaterThanOrEqual(r.r + PLAYER_R - 1e-6);
  });

  it('ignore garbage input', () => {
    const sim = empty(1);
    sim.step([{ x: NaN, z: Infinity as number }]);
    expect(Number.isFinite(sim.dogs[0].x)).toBe(true);
    sim.step([undefined]);
    sim.step([{ x: 5, z: 5 }]);
    expect(Math.hypot(sim.dogs[0].vx, sim.dogs[0].vz)).toBeLessThanOrEqual(WALK + 1e-6);
  });
});

describe('a round', () => {
  it('lasts ROUND_S seconds and scores the pens', () => {
    const sim = new SheepSim(3, { rng: mulberry32(9) });
    expect(sim.length).toBe(ROUND_S);
    run(sim, ROUND_S - 1, idle);
    expect(sim.done).toBe(false);
    run(sim, 1.1, idle);
    expect(sim.done).toBe(true);
    expect(sim.left).toBe(0);
    expect(sim.scores()).toHaveLength(3);
    expect(sim.scores()).toEqual(sim.pens.map((p) => p.points));
  });

  it('works solo', () => {
    const sim = new SheepSim(1, { rng: mulberry32(2) });
    const pen = sim.pens[0];
    // A simple herding bot: get behind the nearest free sheep and push it at the gate.
    run(sim, ROUND_S + 0.1, (i, sm) => {
      const free = sm.sheep.filter((s) => s.state === 'free');
      if (!free.length) return { x: 0, z: 0 };
      const d = sm.dogs[i];
      const s = free.reduce((a, b) => (Math.hypot(a.x - pen.x, a.z - pen.z) < Math.hypot(b.x - pen.x, b.z - pen.z) ? a : b));
      const dx = pen.x - s.x;
      const dz = pen.z - s.z;
      const l = Math.hypot(dx, dz) || 1;
      const gx = s.x - (dx / l) * 2;
      const gz = s.z - (dz / l) * 2;
      return { ...towards(sm, i, gx, gz), whistle: Math.hypot(d.x - s.x, d.z - s.z) < 2.2 && l < 6 };
    });
    expect(sim.done).toBe(true);
    expect(sim.scores()[0]).toBeGreaterThan(0);
  });

  it('ranks by points, ties in join order', () => {
    const sim = empty(3);
    sim.pens[2].points = 4;
    sim.pens[0].points = 1;
    sim.pens[1].points = 1;
    expect(sim.ranking()).toEqual([2, 0, 1]);
    expect(placeText(1)).toBe('1st');
    expect(placeText(5)).toBe('5th');
  });
});

describe('removal', () => {
  it('shuts the pen: sheep inside stay counted, nothing new gets in', () => {
    const sim = empty(2);
    sim.dogs.forEach((d) => ((d.x = 0), (d.z = 0)));
    const pen = sim.pens[1];
    const inside = penWorld(pen, PEN_D * 0.6, 0);
    sim.addSheep(inside.x, inside.z, true);
    sim.step([idle(0, sim), idle(1, sim)]);
    expect(pen.points).toBe(3);
    sim.remove(1);
    expect(pen.closed).toBe(true);
    expect(sim.dogs[1].alive).toBe(false);
    const gate = penWorld(pen, -0.6, 0);
    const s = sim.addSheep(gate.x, gate.z);
    run(sim, 2, (i) => {
      s.vx = pen.nx * 1.5;
      s.vz = pen.nz * 1.5;
      return idle(i, sim);
    });
    expect(s.state).toBe('free');
    expect(pen).toMatchObject({ count: 1, points: 3 });
    expect(sim.ranking()).toEqual([0]);
    // Removing twice is harmless.
    sim.remove(1);
    sim.remove(9);
  });

  it("doesn't scare sheep with a removed player's dog, or move it", () => {
    const sim = empty(1);
    const s = sim.addSheep(0, 0);
    s.grazing = true;
    s.graze = 10;
    sim.dogs[0].x = -1.2;
    sim.dogs[0].z = 0;
    sim.remove(0);
    const ev = run(sim, 1, () => ({ x: 1, z: 0, whistle: true }));
    expect(ev.filter((e) => e.t === 'whistle')).toHaveLength(0);
    expect(sim.dogs[0].x).toBe(-1.2);
    expect(s.alert).toBe(0);
  });

  it("leaves removed players out of the final scores", () => {
    expect(finalScores(['a', 'b', 'c'], [5, 9, 2], new Set([1]))).toEqual({ a: 5, c: 2 });
    expect(finalScores(['a'], [], new Set())).toEqual({ a: 0 });
  });
});

describe('howTo', () => {
  it('is three short lines', () => {
    for (const short of [false, true]) {
      const lines = howTo(short);
      expect(lines).toHaveLength(3);
      lines.forEach((l) => expect(l.length).toBeLessThan(60));
    }
    expect(howTo(true)[2]).not.toBe(howTo(false)[2]);
  });
});
