import { describe, expect, it } from 'vitest';
import {
  BUFFER,
  DASH_CD,
  DASH_SPEED,
  DASH_TIME,
  DROP_TIME,
  DT,
  FUSE_MAX,
  FUSE_MIN,
  HOLDER_BOOST,
  PASS_COOL,
  PLAYER_R,
  PotatoSim,
  TOUCH,
  WALK,
  arenaFor,
  fuseFor,
  howTo,
  resolve,
  spawnFor,
  type PotatoEvent,
  type PotatoInput,
} from '../client/src/games/potato/logic';
import { mulberry32 } from '../client/src/games/rng';

type Driver = (i: number, sim: PotatoSim) => PotatoInput | undefined;

function run(sim: PotatoSim, seconds: number, drive: Driver = () => undefined) {
  const all: PotatoEvent[] = [];
  for (let k = 0; k < Math.round(seconds / DT); k++) all.push(...sim.step(sim.players.map((_, i) => drive(i, sim))));
  return all;
}

/** Park everybody far apart so nobody touches by accident. */
function spread(sim: PotatoSim) {
  const spots = [
    [-9, -5],
    [9, 5],
    [-9, 5],
    [9, -5],
    [-4, -4.5],
    [4, 4.5],
    [-4, 4.5],
    [4, -4.5],
  ];
  sim.players.forEach((p, i) => {
    p.x = spots[i][0];
    p.z = spots[i][1];
  });
}

/** Put player j right next to player i (touching, after the push apart). */
function touch(sim: PotatoSim, i: number, j: number) {
  const a = sim.players[i];
  const b = sim.players[j];
  b.x = a.x + (a.x > 0 ? -1 : 1) * (PLAYER_R * 2 + TOUCH * 0.3);
  b.z = a.z;
}

/** Run until the current potato bursts (or the time runs out). */
function untilBurst(sim: PotatoSim, drive: Driver = () => undefined, max = 30) {
  const all: PotatoEvent[] = [];
  for (let k = 0; k < Math.round(max / DT); k++) {
    const ev = sim.step(sim.players.map((_, i) => drive(i, sim)));
    all.push(...ev);
    if (ev.some((e) => e.t === 'burst')) break;
  }
  return all;
}

describe('the square', () => {
  it('has a bonfire in the middle and room for everybody to start', () => {
    for (let n = 1; n <= 8; n++) {
      const a = arenaFor(n);
      expect(a.obstacles.some((o) => o.kind === 'fire' && o.x === 0 && o.z === 0)).toBe(true);
      const spots = Array.from({ length: n }, (_, i) => spawnFor(a, i, n));
      for (const s of spots) {
        // Not inside anything, and inside the fence.
        const r = resolve(a, s.x, s.z);
        expect(r.hit).toBe(false);
      }
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z)).toBeGreaterThan(PLAYER_R * 2 + TOUCH);
    }
  });
  it('is bigger for more players', () => {
    expect(arenaFor(8).w).toBeGreaterThan(arenaFor(3).w);
  });
  it('pushes you out of hay bales, the bonfire and the fence', () => {
    const a = arenaFor(4);
    const bale = a.obstacles.find((o) => o.kind === 'bale')!;
    const r = resolve(a, bale.x, bale.z);
    expect(r.hit).toBe(true);
    expect(resolve(a, r.x, r.z).hit).toBe(false);
    const f = resolve(a, 0.1, 0);
    expect(Math.hypot(f.x, f.z)).toBeCloseTo(1.15 + PLAYER_R, 5);
    const w = resolve(a, 100, 0);
    expect(w.x).toBeCloseTo(a.w / 2 - PLAYER_R, 5);
  });
  it('can’t be walked through: running into a bale stops you at its edge', () => {
    const sim = new PotatoSim(2, mulberry32(1));
    sim.begin();
    spread(sim);
    const bale = sim.arena.obstacles.find((o) => o.kind === 'bale' && o.hw > o.hd)!;
    const p = sim.players[1];
    p.x = bale.x - bale.hw - 3;
    p.z = bale.z;
    if (sim.holder === 1) sim.potato!.fuse = 999;
    run(sim, 2, (i) => (i === 1 ? { x: 1, z: 0 } : undefined));
    expect(p.x).toBeLessThanOrEqual(bale.x - bale.hw - PLAYER_R + 1e-6);
  });
  it('can’t leave the fence', () => {
    const sim = new PotatoSim(2, mulberry32(1));
    sim.begin();
    sim.potato!.fuse = 999;
    run(sim, 6, () => ({ x: 1, z: 1 }));
    for (const p of sim.players) {
      expect(p.x).toBeLessThanOrEqual(sim.arena.w / 2 - PLAYER_R + 1e-6);
      expect(p.z).toBeLessThanOrEqual(sim.arena.h / 2 - PLAYER_R + 1e-6);
    }
  });
});

describe('moving', () => {
  it('the holder runs about 12 % faster', () => {
    const sim = new PotatoSim(2, mulberry32(3));
    sim.begin();
    spread(sim);
    sim.potato!.fuse = 999;
    const h = sim.holder;
    run(sim, 0.6, () => ({ x: 0, z: -1 }));
    run(sim, 0.01, () => ({ x: 0, z: 0.0001 }));
    const sim2 = new PotatoSim(2, mulberry32(3));
    sim2.begin();
    spread(sim2);
    sim2.players.forEach((p) => (p.z = -4.5));
    sim2.players[0].x = -4;
    sim2.players[1].x = 4;
    sim2.potato!.fuse = 999;
    run(sim2, 0.5, () => ({ x: 0, z: 1 }));
    const speeds = sim2.players.map((p) => Math.hypot(p.vx, p.vz));
    expect(speeds[sim2.holder]).toBeCloseTo(WALK * HOLDER_BOOST, 3);
    expect(speeds[1 - sim2.holder]).toBeCloseTo(WALK, 3);
    expect(h).toBeGreaterThanOrEqual(0);
  });
  it('pierogi never overlap', () => {
    const sim = new PotatoSim(6, mulberry32(4));
    sim.begin();
    sim.potato!.fuse = 999;
    // Everybody runs into the middle.
    run(sim, 3, (i, s) => {
      const p = s.players[i];
      const l = Math.hypot(p.x, p.z) || 1;
      return { x: -p.x / l, z: -p.z / l };
    });
    for (let i = 0; i < 6; i++)
      for (let j = i + 1; j < 6; j++) {
        const a = sim.players[i];
        const b = sim.players[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(PLAYER_R * 2 - 0.25);
      }
  });
  it('dashes in the facing direction, then cools down for 3 s', () => {
    const sim = new PotatoSim(2, mulberry32(5));
    sim.begin();
    spread(sim);
    sim.potato!.fuse = 999;
    run(sim, 0.2, (i) => (i === 0 ? { x: 1, z: 0 } : undefined));
    const ev = run(sim, DT, (i) => (i === 0 ? { x: 1, z: 0, dash: true } : undefined));
    expect(ev).toContainEqual({ t: 'dash', i: 0 });
    expect(sim.players[0].vx).toBeCloseTo(DASH_SPEED, 5);
    const x0 = sim.players[0].x;
    run(sim, DASH_TIME, (i) => (i === 0 ? { x: 1, z: 0 } : undefined));
    expect(sim.players[0].x - x0).toBeGreaterThan(DASH_SPEED * DASH_TIME * 0.85);
    // Pressing again during the cooldown does nothing…
    const again = run(sim, 1, (i) => (i === 0 ? { x: 1, z: 0, dash: true } : undefined));
    expect(again.filter((e) => e.t === 'dash')).toHaveLength(0);
    // …until it is ready again (a press just before counts).
    const later = run(sim, DASH_CD, (i, s) => (i === 0 ? { x: -1, z: 0, dash: s.players[0].dashCd > 0 && s.players[0].dashCd < BUFFER * 0.5 } : undefined));
    expect(later.filter((e) => e.t === 'dash')).toHaveLength(1);
  });
  it('a dash bumps whoever it hits', () => {
    const sim = new PotatoSim(3, mulberry32(5));
    sim.begin();
    spread(sim);
    sim.potato!.holder = 2;
    sim.potato!.fuse = 999;
    sim.players[0].x = 0;
    sim.players[0].z = 4;
    sim.players[1].x = 2.2;
    sim.players[1].z = 4;
    run(sim, 0.1, (i) => (i === 0 ? { x: 1, z: 0 } : undefined));
    const ev = run(sim, 0.3, (i) => (i === 0 ? { x: 1, z: 0, dash: true } : undefined));
    expect(ev).toContainEqual({ t: 'bump', i: 0, j: 1 });
    expect(sim.players[1].x).toBeGreaterThan(2.6);
  });
  it('a player without input (disconnected) just stands there', () => {
    const sim = new PotatoSim(2, mulberry32(5));
    sim.begin();
    spread(sim);
    sim.potato!.fuse = 999;
    const { x, z } = sim.players[0];
    run(sim, 1);
    expect(sim.players[0].x).toBeCloseTo(x, 6);
    expect(sim.players[0].z).toBeCloseTo(z, 6);
  });
  it('ignores junk input', () => {
    const sim = new PotatoSim(2, mulberry32(5));
    sim.begin();
    run(sim, 0.5, () => ({ x: NaN, z: Infinity as number }));
    for (const p of sim.players) expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
  });
});

describe('the potato', () => {
  it('starts on one random player before the round begins, and only cooks once it has', () => {
    const holders = new Set<number>();
    for (let s = 1; s < 40; s++) {
      const sim = new PotatoSim(4, mulberry32(s));
      expect(sim.holder).toBeGreaterThanOrEqual(0);
      holders.add(sim.holder);
      run(sim, 1);
      expect(sim.potato!.t).toBe(0);
    }
    expect(holders.size).toBe(4);
  });
  it('has a hidden 9–22 s fuse, a bit shorter as fewer are left', () => {
    const rng = mulberry32(9);
    for (let k = 0; k < 300; k++) {
      const f = fuseFor(8, rng);
      expect(f).toBeGreaterThanOrEqual(FUSE_MIN);
      expect(f).toBeLessThanOrEqual(FUSE_MAX);
    }
    expect(fuseFor(2, () => 0.5)).toBeLessThan(fuseFor(4, () => 0.5));
    expect(fuseFor(4, () => 0.5)).toBeLessThan(fuseFor(6, () => 0.5));
    expect(fuseFor(2, () => 0)).toBeGreaterThan(6);
  });
  it('passes on touch, with no instant pass-back', () => {
    const sim = new PotatoSim(2, mulberry32(2));
    sim.begin();
    spread(sim);
    const pot = sim.potato!;
    pot.fuse = 999;
    run(sim, PASS_COOL + 0.05);
    const h = sim.holder;
    const o = 1 - h;
    touch(sim, h, o);
    const ev = run(sim, DT);
    expect(ev).toContainEqual({ t: 'pass', from: h, to: o });
    expect(sim.holder).toBe(o);
    expect(sim.potato!.from).toBe(h);
    expect(sim.players[h].passes).toBe(1);
    // Still touching: it stays put for the cooldown…
    const during = run(sim, PASS_COOL - 2 * DT, (_, s) => {
      touch(s, o, h);
      return undefined;
    });
    expect(during.filter((e) => e.t === 'pass')).toHaveLength(0);
    // …then goes back.
    const after = run(sim, 4 * DT, (_, s) => {
      touch(s, o, h);
      return undefined;
    });
    expect(after.filter((e) => e.t === 'pass')).toHaveLength(1);
    expect(sim.holder).toBe(h);
  });
  it('a dropped potato can’t be passed straight away either', () => {
    const sim = new PotatoSim(2, mulberry32(2));
    sim.begin();
    touch(sim, sim.holder, 1 - sim.holder);
    const h = sim.holder;
    expect(run(sim, PASS_COOL - 2 * DT, (_, s) => (touch(s, h, 1 - h), undefined)).some((e) => e.t === 'pass')).toBe(false);
    expect(run(sim, 4 * DT, (_, s) => (touch(s, h, 1 - h), undefined)).some((e) => e.t === 'pass')).toBe(true);
  });
  it('passes to the nearest one when several are touching', () => {
    const sim = new PotatoSim(3, mulberry32(2));
    sim.begin();
    spread(sim);
    sim.potato!.holder = 0;
    sim.potato!.cool = 0;
    sim.potato!.fuse = 999;
    const a = sim.players[0];
    a.x = 0;
    a.z = 4;
    sim.players[1].x = a.x + PLAYER_R * 2 + 0.1;
    sim.players[1].z = a.z;
    sim.players[2].x = a.x;
    sim.players[2].z = a.z - PLAYER_R * 2 - 0.02;
    const ev = run(sim, DT);
    expect(ev).toContainEqual({ t: 'pass', from: 0, to: 2 });
  });
  it('does not pass to somebody a little way off', () => {
    const sim = new PotatoSim(2, mulberry32(2));
    sim.begin();
    spread(sim);
    sim.potato!.cool = 0;
    sim.potato!.fuse = 999;
    const h = sim.holder;
    const a = sim.players[h];
    const b = sim.players[1 - h];
    a.x = -3;
    a.z = 4;
    b.x = a.x + PLAYER_R * 2 + TOUCH + 0.2;
    b.z = a.z;
    expect(run(sim, DT).some((e) => e.t === 'pass')).toBe(false);
  });
  it('heats up as it cooks', () => {
    const sim = new PotatoSim(2, mulberry32(2));
    sim.begin();
    spread(sim);
    sim.potato!.fuse = 10;
    run(sim, 5);
    expect(sim.heat).toBeCloseTo(0.5, 1);
  });
  it('bursts on whoever holds it: they are out, and a new one drops on a survivor 2 s later', () => {
    const sim = new PotatoSim(4, mulberry32(7));
    sim.begin();
    spread(sim);
    const h = sim.holder;
    const fuse = sim.potato!.fuse;
    const ev = untilBurst(sim);
    const burst = ev.find((e) => e.t === 'burst');
    expect(burst).toMatchObject({ t: 'burst', i: h, n: 1 });
    expect(sim.time).toBeCloseTo(fuse, 1);
    expect(sim.players[h].alive).toBe(false);
    expect(sim.players[h].outAt).toBe(1);
    expect(sim.phase).toBe('drop');
    expect(sim.potato).toBeNull();
    const none = run(sim, DROP_TIME - 2 * DT);
    expect(none.some((e) => e.t === 'drop')).toBe(false);
    const drop = run(sim, 3 * DT).find((e) => e.t === 'drop');
    expect(drop).toBeDefined();
    if (drop?.t !== 'drop') return;
    expect(drop.n).toBe(2);
    expect(drop.i).not.toBe(h);
    expect(sim.players[drop.i].alive).toBe(true);
    expect(sim.phase).toBe('play');
    expect(sim.potato!.t).toBeLessThan(0.1);
  });
  it('the mashed don’t move, block or catch the potato', () => {
    const sim = new PotatoSim(3, mulberry32(7));
    sim.begin();
    spread(sim);
    const h = sim.holder;
    untilBurst(sim);
    const out = sim.players[h];
    const { x, z } = out;
    run(sim, DROP_TIME + 0.1, (i) => (i === h ? { x: 1, z: 0 } : undefined));
    expect(out.x).toBe(x);
    expect(out.z).toBe(z);
    // Touching the mashed one doesn't pass to them.
    const nh = sim.holder;
    sim.potato!.cool = 0;
    sim.potato!.fuse = 999;
    out.x = sim.players[nh].x + PLAYER_R * 2;
    out.z = sim.players[nh].z;
    expect(run(sim, DT).some((e) => e.t === 'pass')).toBe(false);
  });
  it('with two players one burst ends the round', () => {
    const sim = new PotatoSim(2, mulberry32(11));
    sim.begin();
    spread(sim);
    const h = sim.holder;
    const ev = untilBurst(sim);
    expect(ev.some((e) => e.t === 'over')).toBe(true);
    expect(sim.over).toBe(true);
    expect(sim.phase).toBe('done');
    const r = sim.results();
    expect(r.winners).toEqual([1 - h]);
    expect(r.points[1 - h]).toBe(3);
    expect(r.points[h]).toBe(0);
    expect(r.bursts).toBe(1);
  });
});

describe('a whole round', () => {
  it('goes on until one is left, and scores by how long you lasted', () => {
    const sim = new PotatoSim(5, mulberry32(21));
    sim.begin();
    spread(sim);
    const order: number[] = [];
    let overs = 0;
    for (let k = 0; k < Math.round(200 / DT) && !sim.over; k++) {
      for (const e of sim.step([])) {
        if (e.t === 'burst') order.push(e.i);
        if (e.t === 'over') overs++;
      }
    }
    expect(sim.over).toBe(true);
    expect(overs).toBe(1);
    expect(order).toHaveLength(4);
    expect(new Set(order).size).toBe(4);
    const winner = [0, 1, 2, 3, 4].find((i) => !order.includes(i))!;
    const r = sim.results();
    expect(r.winners).toEqual([winner]);
    // 0, 1, 2, 3 for the mashed in order; 4 + 2 for the winner.
    order.forEach((i, k) => expect(r.points[i]).toBe(k));
    expect(r.points[winner]).toBe(6);
    // Nothing more happens once it's over.
    expect(run(sim, 5).filter((e) => e.t !== 'dash' && e.t !== 'bump')).toEqual([]);
  });
  it('keeps chasing: a holder that runs at someone passes it', () => {
    const sim = new PotatoSim(2, mulberry32(3));
    sim.begin();
    sim.potato!.fuse = 999;
    const h = sim.holder;
    sim.players[h].x = -4.5;
    sim.players[h].z = 2.2;
    sim.players[1 - h].x = 4.5;
    sim.players[1 - h].z = 2.2;
    // The holder chases; the other stands still.
    const ev = run(sim, 4, (i, s) => {
      if (i !== s.holder || i !== h) return undefined;
      const a = s.players[i];
      const b = s.players[1 - i];
      return { x: b.x - a.x, z: b.z - a.z };
    });
    expect(ev.some((e) => e.t === 'pass' && e.from === h)).toBe(true);
  });
});

describe('leaving', () => {
  it('when the holder leaves, their potato goes too and a new one drops on somebody else', () => {
    const sim = new PotatoSim(3, mulberry32(5));
    sim.begin();
    spread(sim);
    run(sim, 1);
    const h = sim.holder;
    sim.remove(h);
    expect(sim.potato).toBeNull();
    const ev = run(sim, DT);
    expect(ev).toContainEqual({ t: 'lost', i: h });
    expect(sim.phase).toBe('drop');
    const drop = run(sim, DROP_TIME + 0.1).find((e) => e.t === 'drop');
    expect(drop && drop.t === 'drop' && drop.i).not.toBe(h);
    expect(sim.bursts).toBe(0);
    expect(sim.players[h].outAt).toBeNull();
  });
  it('a holder leaving before the round starts hands the potato to somebody else straight away', () => {
    const sim = new PotatoSim(3, mulberry32(5));
    const h = sim.holder;
    sim.remove(h);
    expect(sim.holder).toBeGreaterThanOrEqual(0);
    expect(sim.holder).not.toBe(h);
    sim.begin();
    expect(sim.phase).toBe('play');
  });
  it('ends the round when only one is left, who wins it', () => {
    const sim = new PotatoSim(2, mulberry32(5));
    sim.begin();
    spread(sim);
    run(sim, 1);
    const h = sim.holder;
    sim.remove(h);
    const ev = run(sim, DT);
    expect(ev).toContainEqual({ t: 'over' });
    const r = sim.results();
    expect(r.points[h]).toBe(0);
    expect(r.points[1 - h]).toBe(2);
    expect(r.winners).toEqual([1 - h]);
  });
  it('somebody else leaving doesn’t disturb the potato', () => {
    const sim = new PotatoSim(4, mulberry32(5));
    sim.begin();
    spread(sim);
    run(sim, 1);
    const h = sim.holder;
    const other = [0, 1, 2, 3].find((i) => i !== h)!;
    const t = sim.potato!.t;
    sim.remove(other);
    run(sim, DT);
    expect(sim.holder).toBe(h);
    expect(sim.potato!.t).toBeGreaterThan(t);
    expect(sim.results().points[other]).toBe(0);
  });
  it('players gone before the round never get the potato', () => {
    for (let s = 1; s < 30; s++) {
      const sim = new PotatoSim(4, mulberry32(s), [true, false, true, false]);
      expect([1, 3]).toContain(sim.holder);
      sim.begin();
      spread(sim);
      for (let k = 0; k < Math.round(60 / DT) && !sim.over; k++) sim.step([]);
      expect(sim.over).toBe(true);
      expect(sim.results().points[0]).toBe(0);
      expect(sim.results().points[2]).toBe(0);
    }
  });
  it('a disconnected holder (no input) still gets mashed, so nobody waits for them', () => {
    const sim = new PotatoSim(3, mulberry32(8));
    sim.begin();
    spread(sim);
    const h = sim.holder;
    const ev = untilBurst(sim, (i) => (i === h ? undefined : { x: 0, z: 0 }), FUSE_MAX + 1);
    expect(ev.some((e) => e.t === 'burst' && e.i === h)).toBe(true);
  });
  it('playing on your own ends straight away', () => {
    const sim = new PotatoSim(1, mulberry32(1));
    expect(sim.solo).toBe(true);
    expect(sim.potato).toBeNull();
    sim.begin();
    expect(run(sim, DT)).toContainEqual({ t: 'over' });
    expect(sim.results().points).toEqual([0]);
  });
  it('removing everybody is safe', () => {
    const sim = new PotatoSim(3, mulberry32(1));
    sim.begin();
    [0, 1, 2].forEach((i) => sim.remove(i));
    sim.remove(1);
    sim.remove(7);
    run(sim, 1);
    expect(sim.over).toBe(true);
    expect(sim.results().winners).toEqual([]);
  });
});

it('has a three-line how-to', () => {
  expect(howTo(false)).toHaveLength(3);
  expect(howTo(true)).toHaveLength(3);
  expect(howTo(true)[2]).toMatch(/One round/);
  expect(howTo(false)[2]).toMatch(/Three rounds/);
});
