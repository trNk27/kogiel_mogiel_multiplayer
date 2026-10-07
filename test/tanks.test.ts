import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../client/src/games/rng';
import {
  ARENA_H,
  ARENA_W,
  DT,
  HX,
  HZ,
  TANKS_ROUNDS,
  TANKS_ROUNDS_SHORT,
  TEMPLATES,
  TUNING,
  TanksSim,
  angDiff,
  armourHearts,
  circleBox,
  howTo,
  isConnected,
  makeLayout,
  roundPoints,
  spawnPoints,
  staticObstacles,
  type Layout,
  type Ob,
  type TankInput,
} from '../client/src/games/tanks/logic';

const NONE: TankInput = { x: 0, y: 0, fire: 0, mortar: 0 };
const stick = (x: number, y: number): TankInput => ({ x, y, fire: 0, mortar: 0 });

/** An empty arena (no obstacles), with the given tanks placed exactly where we want them. */
function arena(n: number, spots: { x: number; z: number; h?: number }[], obstacles: Ob[] = []) {
  const layout: Layout = { template: 0, name: 'test', obstacles };
  const sim = new TanksSim(n, mulberry32(1), { layout, shuffle: false });
  sim.locked = false;
  spots.forEach((s, i) => {
    const t = sim.tanks[i];
    t.x = s.x;
    t.z = s.z;
    t.h = t.t = s.h ?? 0;
    t.protect = 0;
  });
  return sim;
}

function run(sim: TanksSim, ticks: number, inputs: (tick: number) => TankInput[] = () => []) {
  const ev = [];
  for (let k = 0; k < ticks; k++) ev.push(...sim.step(inputs(k)));
  return ev;
}

const wall = (x: number, z: number, hx: number, hz: number, id = 1): Ob => ({ id, kind: 'wall', x, z, hx, hz, hp: 99, alive: true });
const crate = (x: number, z: number, id = 2): Ob => ({ id, kind: 'crate', x, z, hx: 0.8, hz: 0.8, hp: TUNING.crateHp, alive: true });

describe('driving', () => {
  it('speed scales with the stick and the tank stops when it is released', () => {
    const a = arena(2, [{ x: -10, z: 0, h: Math.PI / 2 }, { x: -10, z: 8 }]);
    run(a, 60, () => [stick(1, 0), NONE]);
    const full = a.tanks[0].x + 10;
    const b = arena(2, [{ x: -10, z: 0, h: Math.PI / 2 }, { x: -10, z: 8 }]);
    run(b, 60, () => [stick(0.5, 0), NONE]);
    const half = b.tanks[0].x + 10;
    expect(full).toBeGreaterThan(half * 1.6);
    expect(full).toBeGreaterThan(4);
    const before = a.tanks[0].x;
    run(a, 30, () => [NONE, NONE]);
    expect(a.tanks[0].speed).toBe(0);
    expect(a.tanks[0].x - before).toBeLessThan(0.5);
  });

  it('turns the hull at a limited rate and drives forward only when roughly lined up', () => {
    const sim = arena(2, [{ x: 0, z: 0, h: 0 }, { x: 10, z: 8 }]);
    // Stick pointing sideways (+x): 90 degrees away, within the driving cone.
    run(sim, 6, () => [stick(1, 0), NONE]);
    const t = sim.tanks[0];
    expect(Math.abs(angDiff(t.h, Math.PI / 2))).toBeGreaterThan(0.5);
    run(sim, 60, () => [stick(1, 0), NONE]);
    expect(Math.abs(angDiff(t.h, Math.PI / 2))).toBeLessThan(0.01);
    // The turn rate is limited: after 10 ticks at most turn * 10 * DT.
    const s2 = arena(2, [{ x: 0, z: 0, h: 0 }, { x: 10, z: 8 }]);
    run(s2, 10, () => [stick(0, -1), NONE]);
    expect(Math.abs(angDiff(s2.tanks[0].h, 0))).toBeLessThanOrEqual(TUNING.turn * 10 * DT + 1e-9);
  });

  it('turns on the spot when the wanted direction is behind it', () => {
    const sim = arena(2, [{ x: 0, z: 0, h: 0 }, { x: 10, z: 8 }]);
    // Facing +z, stick wants -z (180 degrees away).
    run(sim, 20, () => [stick(0, -1), NONE]);
    expect(Math.hypot(sim.tanks[0].x, sim.tanks[0].z)).toBeLessThan(0.05);
    expect(sim.tanks[0].speed).toBe(0);
    run(sim, 90, () => [stick(0, -1), NONE]);
    expect(sim.tanks[0].z).toBeLessThan(-0.5);
  });

  it('the turret follows the stick quickly and keeps its heading when the stick is let go', () => {
    const sim = arena(2, [{ x: 0, z: 0, h: 0 }, { x: 10, z: 8 }]);
    run(sim, 18, () => [stick(1, 0), NONE]);
    expect(Math.abs(angDiff(sim.tanks[0].t, Math.PI / 2))).toBeLessThan(0.01);
    expect(Math.abs(angDiff(sim.tanks[0].h, Math.PI / 2))).toBeGreaterThan(0.1);
    const aim = sim.tanks[0].t;
    run(sim, 60, () => [NONE, NONE]);
    expect(sim.tanks[0].t).toBe(aim);
  });
});

describe('collisions', () => {
  it('stops at a wall and slides along it', () => {
    const sim = arena(2, [{ x: 0, z: 0, h: 0 }, { x: -15, z: -9 }], [wall(0, 4, 20, 0.5)]);
    // Drive diagonally into the wall: +z and +x. The wall blocks z but x keeps going.
    run(sim, 120, () => [stick(0.7, 0.7), NONE]);
    const t = sim.tanks[0];
    expect(t.z).toBeLessThanOrEqual(4 - 0.5 - TUNING.radius + 1e-6);
    expect(t.x).toBeGreaterThan(2);
  });

  it('is kept inside the arena', () => {
    const sim = arena(2, [{ x: HX - 3, z: 0, h: Math.PI / 2 }, { x: -15, z: 9 }]);
    run(sim, 180, () => [stick(1, 0), NONE]);
    expect(sim.tanks[0].x).toBeLessThanOrEqual(HX - TUNING.radius + 1e-6);
  });

  it('bumps into crates and other tanks', () => {
    const sim = arena(3, [{ x: 0, z: 0, h: 0 }, { x: 0, z: 6, h: 0 }, { x: 15, z: -9 }], [crate(10, 0)]);
    run(sim, 20, () => [stick(0, 1), NONE, NONE]);
    expect(Math.hypot(sim.tanks[0].x - sim.tanks[1].x, sim.tanks[0].z - sim.tanks[1].z)).toBeGreaterThanOrEqual(TUNING.radius * 1.9 - 0.01);
    run(sim, 150, () => [stick(0, 1), NONE, NONE]);
    // The shoved tank ends up against the far wall and the shover stops behind it.
    expect(sim.tanks[0].z).toBeLessThanOrEqual(HZ - TUNING.radius * 2.9 + 0.05);
    expect(Math.hypot(sim.tanks[0].x - sim.tanks[1].x, sim.tanks[0].z - sim.tanks[1].z)).toBeGreaterThanOrEqual(TUNING.radius * 1.9 - 0.01);
    const s2 = arena(2, [{ x: 4, z: 0, h: Math.PI / 2 }, { x: -15, z: 9 }], [crate(10, 0)]);
    run(s2, 150, () => [stick(1, 0), NONE]);
    expect(s2.tanks[0].x).toBeLessThanOrEqual(10 - 0.8 - TUNING.radius + 1e-6);
  });

  it('circleBox pushes a circle out of a box along the nearest face', () => {
    const p = circleBox(1.2, 0, 0.5, { x: 0, z: 0, hx: 1, hz: 1 })!;
    expect(p.nx).toBe(1);
    expect(p.pen).toBeCloseTo(0.3);
    expect(circleBox(3, 0, 0.5, { x: 0, z: 0, hx: 1, hz: 1 })).toBeNull();
  });
});

describe('shells', () => {
  it('flies at 22 m/s and respects the cooldown and the two-shell limit', () => {
    const sim = arena(2, [{ x: -18, z: 0, h: Math.PI / 2 }, { x: 15, z: 9 }]);
    sim.step([{ ...NONE, fire: 1 }, NONE]);
    expect(sim.shells.length).toBe(1);
    sim.step([{ ...NONE, fire: 1 }, NONE]);
    expect(sim.shells.length).toBe(1); // cooling down
    run(sim, 20);
    const x0 = sim.shells[0].x;
    run(sim, 6);
    expect((sim.shells[0].x - x0) / (6 * DT)).toBeCloseTo(TUNING.shellSpeed, 0);
    // Wait out the cooldown and fire again, then a third is refused.
    run(sim, 20);
    sim.step([{ ...NONE, fire: 1 }, NONE]);
    expect(sim.shells.length).toBe(2);
    run(sim, 40);
    sim.step([{ ...NONE, fire: 1 }, NONE]);
    expect(sim.shellsOf(0)).toBeLessThanOrEqual(2);
  });

  it('ricochets once off a wall and pops on the second contact', () => {
    // Shoot straight at the right-hand edge and further walls: bounce, travel back, bounce again = pop.
    const sim = arena(2, [{ x: 0, z: 0, h: Math.PI / 2 }, { x: -15, z: 9 }], [wall(8, 0, 0.5, 3)]);
    const ev = run(sim, 6, (k) => [k === 0 ? { ...NONE, fire: 1 } : NONE, NONE]);
    expect(ev.filter((e) => e.e === 'shot').length).toBe(1);
    let bounces = 0;
    let pops = 0;
    for (let k = 0; k < 240 && sim.shells.length; k++) {
      for (const e of sim.step([NONE, NONE])) {
        if (e.e === 'bounce') bounces++;
        if (e.e === 'pop') pops++;
      }
      // After the first bounce the shell comes straight back towards the shooter's side.
      if (bounces === 1 && sim.shells.length) expect(sim.shells[0].vx).toBeLessThan(0);
      if (bounces === 1 && sim.shells.length) expect(sim.shells[0].bounces).toBe(1);
    }
    expect(bounces).toBe(1);
    expect(pops).toBe(1);
    expect(sim.shells.length).toBe(0);
  });

  it('can hit its own tank after bouncing, but not before', () => {
    // Tank 0 faces a wall 3 m away: the shell bounces straight back into it.
    const sim = arena(2, [{ x: 0, z: 0, h: Math.PI / 2 }, { x: -15, z: 9 }], [wall(5, 0, 0.5, 4)]);
    const ev = run(sim, 40, (k) => [k === 0 ? { ...NONE, fire: 1 } : NONE, NONE]);
    const hit = ev.find((e) => e.e === 'hit' || e.e === 'ko');
    expect(hit).toBeTruthy();
    expect(hit && 'idx' in hit && hit.idx).toBe(0);
    expect(sim.tanks[0].armour).toBe(TUNING.armour - 1);
    expect(sim.tanks[0].killer).toBe(0);
    // Shooting away from everything with a clear field never hurts the shooter on the way out.
    const s2 = arena(2, [{ x: -10, z: 0, h: Math.PI / 2 }, { x: -15, z: 9 }]);
    s2.step([{ ...NONE, fire: 1 }, NONE]);
    expect(s2.tanks[0].armour).toBe(TUNING.armour);
  });

  it('a shell hit costs one armour and credits the shooter on knock-out', () => {
    const sim = arena(2, [{ x: -10, z: 0, h: Math.PI / 2 }, { x: 8, z: 0 }]);
    for (let n = 0; n < TUNING.armour; n++) {
      run(sim, 1, () => [{ ...NONE, fire: 1 }, NONE]);
      run(sim, 50);
      expect(sim.tanks[1].armour).toBe(Math.max(0, TUNING.armour - n - 1));
      if (n < TUNING.armour - 1) expect(sim.tanks[1].alive).toBe(true);
    }
    expect(sim.tanks[1].alive).toBe(false);
    expect(sim.tanks[0].kos).toBe(1);
    expect(sim.over).toBe(true);
    expect(sim.winner).toBe(0);
    // The wreck stays as an obstacle.
    expect(sim.obstacles.some((o) => o.kind === 'wreck')).toBe(true);
  });

  it('spawn protection soaks up shells', () => {
    const sim = arena(2, [{ x: -10, z: 0, h: Math.PI / 2 }, { x: 8, z: 0 }]);
    sim.tanks[1].protect = 2;
    run(sim, 50, (k) => [k === 0 ? { ...NONE, fire: 1 } : NONE, NONE]);
    expect(sim.tanks[1].armour).toBe(TUNING.armour);
  });

  it('two shells meeting both pop', () => {
    const sim = arena(2, [{ x: -10, z: 0, h: Math.PI / 2 }, { x: 10, z: 0, h: -Math.PI / 2 }]);
    const ev = run(sim, 30, (k) => [k === 0 ? { ...NONE, fire: 1 } : NONE, k === 0 ? { ...NONE, fire: 1 } : NONE]);
    expect(ev.some((e) => e.e === 'clash')).toBe(true);
    expect(sim.shells.length).toBe(0);
    expect(sim.tanks[0].armour).toBe(TUNING.armour);
    expect(sim.tanks[1].armour).toBe(TUNING.armour);
  });
});

describe('mortar', () => {
  it('lands about 11 m ahead after a second and splashes tanks inside 3 m, you included', () => {
    const sim = arena(3, [{ x: -10, z: 0, h: Math.PI / 2 }, { x: 2, z: 1.5 }, { x: 2, z: 9 }]);
    sim.step([{ ...NONE, mortar: 1 }, NONE, NONE]);
    expect(sim.mortars.length).toBe(1);
    expect(sim.mortars[0].tx).toBeCloseTo(-10 + TUNING.mortarRange - 0, 1);
    expect(sim.mortars[0].tz).toBeCloseTo(0, 1);
    // Still in the air at 0.9 s, down by 1.1 s.
    run(sim, 52);
    expect(sim.mortars.length).toBe(1);
    expect(sim.tanks[1].armour).toBe(TUNING.armour);
    const ev = run(sim, 10);
    expect(ev.some((e) => e.e === 'splash')).toBe(true);
    expect(sim.mortars.length).toBe(0);
    expect(sim.tanks[1].armour).toBe(TUNING.armour - 1); // 1.5 m from the target
    expect(sim.tanks[2].armour).toBe(TUNING.armour); // far away
    // Knocked back, away from the blast.
    expect(sim.tanks[1].kz).toBeGreaterThan(0);
    // The shooter standing in their own splash is hurt too.
    const s2 = arena(2, [{ x: -5, z: 0, h: Math.PI / 2 }, { x: 15, z: 9 }]);
    s2.tanks[0].mortarCool = 0;
    s2.step([{ ...NONE, mortar: 1 }, NONE]);
    s2.mortars[0].tx = -5;
    s2.mortars[0].tz = 0;
    run(s2, 62);
    expect(s2.tanks[0].armour).toBe(TUNING.armour - 1);
  });

  it('clamps the landing point inside the arena', () => {
    const sim = arena(2, [{ x: 18, z: 0, h: Math.PI / 2 }, { x: -15, z: 9 }]);
    sim.step([{ ...NONE, mortar: 1 }, NONE]);
    expect(sim.mortars[0].tx).toBeLessThan(HX);
    expect(sim.mortars[0].tx).toBeCloseTo(HX - 0.8, 5);
    const s2 = arena(2, [{ x: 0, z: -10, h: Math.PI }, { x: -15, z: 9 }]);
    expect(s2.mortarTarget(s2.tanks[0]).z).toBeCloseTo(-HZ + 0.8, 5);
  });

  it('has a cooldown of about four seconds', () => {
    const sim = arena(2, [{ x: -10, z: 0, h: Math.PI / 2 }, { x: 15, z: 9 }]);
    sim.step([{ ...NONE, mortar: 1 }, NONE]);
    run(sim, 100, (k) => (k === 50 ? [{ ...NONE, mortar: 1 }, NONE] : []));
    expect(sim.mortars.length + 0).toBeLessThanOrEqual(1);
    const fired = [] as number[];
    const s2 = arena(2, [{ x: -10, z: 0, h: Math.PI / 2 }, { x: 15, z: 9 }]);
    for (let k = 0; k < 600; k++)
      for (const e of s2.step([{ ...NONE, mortar: 1 }, NONE])) if (e.e === 'lob') fired.push(k);
    expect(fired[1] - fired[0]).toBeGreaterThanOrEqual(Math.round(TUNING.mortarCool / DT) - 1);
    expect(fired[1] - fired[0]).toBeLessThanOrEqual(Math.round(TUNING.mortarCool / DT) + 2);
  });

  it('flies over walls', () => {
    const sim = arena(2, [{ x: -10, z: 0, h: Math.PI / 2 }, { x: 1.5, z: 0 }], [wall(-3, 0, 0.5, 6)]);
    sim.step([{ ...NONE, mortar: 1 }, NONE]);
    run(sim, 62);
    expect(sim.tanks[1].armour).toBe(TUNING.armour - 1);
  });
});

describe('crates', () => {
  it('break after two shell hits', () => {
    const sim = arena(2, [{ x: -10, z: 0, h: Math.PI / 2 }, { x: 15, z: 9 }], [crate(0, 0)]);
    sim.step([{ ...NONE, fire: 1 }, NONE]);
    run(sim, 30);
    const c = sim.obstacles[0];
    expect(c.hp).toBe(1);
    expect(c.alive).toBe(true);
    // The first shell bounced; pop it by waiting, then fire again.
    run(sim, 120);
    sim.step([{ ...NONE, fire: 1 }, NONE]);
    const ev = run(sim, 30);
    expect(c.alive).toBe(false);
    expect(ev.some((e) => e.e === 'crate')).toBe(true);
    // Broken crates no longer block.
    sim.tanks[0].x = -3;
    run(sim, 90, () => [stick(1, 0), NONE]);
    expect(sim.tanks[0].x).toBeGreaterThan(1);
  });

  it('are destroyed by one mortar blast', () => {
    const sim = arena(2, [{ x: -10, z: 0, h: Math.PI / 2 }, { x: 15, z: 9 }], [crate(1, 1)]);
    sim.step([{ ...NONE, mortar: 1 }, NONE]);
    run(sim, 62);
    expect(sim.obstacles[0].alive).toBe(false);
  });
});

describe('layouts', () => {
  it('has several templates and every one keeps clear of the spawn ring', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(4);
    for (let t = 0; t < TEMPLATES.length; t++)
      for (const o of staticObstacles(t)) {
        expect(Math.abs(o.x) + o.hx).toBeLessThan(HX - 5);
        expect(Math.abs(o.z) + o.hz).toBeLessThan(HZ - 3.5);
      }
  });

  it('spawn points are spread around the edge, facing the centre, and symmetric for even counts', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      const sp = spawnPoints(n);
      expect(sp.length).toBe(n);
      for (const s of sp) {
        const edge = Math.min(HX - Math.abs(s.x), HZ - Math.abs(s.z));
        expect(edge).toBeLessThan(3);
        // facing the centre
        expect(Math.sin(s.h) * -s.x + Math.cos(s.h) * -s.z).toBeGreaterThan(0);
      }
      if (n % 2 === 0) for (const s of sp) expect(sp.some((o) => Math.abs(o.x + s.x) < 1e-6 && Math.abs(o.z + s.z) < 1e-6)).toBe(true);
    }
  });

  it('every template with random crates lets every spawn reach every area', () => {
    const spawns = spawnPoints(8);
    for (let t = 0; t < TEMPLATES.length; t++) {
      expect(isConnected(staticObstacles(t), spawns)).toBe(true);
      for (let seed = 1; seed <= 12; seed++) {
        const l = makeLayout(mulberry32(seed * 31 + t), t);
        expect(isConnected(l.obstacles, spawns)).toBe(true);
        const crates = l.obstacles.filter((o) => o.kind === 'crate');
        expect(crates.length).toBeGreaterThan(7);
        // crates never overlap one another or the fixed obstacles
        for (const a of crates)
          for (const b of l.obstacles) if (a !== b) expect(Math.abs(a.x - b.x) < a.hx + b.hx - 0.01 && Math.abs(a.z - b.z) < a.hz + b.hz - 0.01).toBe(false);
      }
    }
  });

  it('detects a blocked-off area', () => {
    const wallOff: Ob[] = [wall(0, 0, 0.5, HZ + 1)];
    expect(isConnected(wallOff, spawnPoints(2))).toBe(false);
  });

  it('picks different layouts from round to round', () => {
    const names = new Set<string>();
    for (let seed = 1; seed < 30; seed++) names.add(makeLayout(mulberry32(seed)).name);
    expect(names.size).toBeGreaterThanOrEqual(3);
    expect(ARENA_W).toBe(44);
    expect(ARENA_H).toBe(26);
  });
});

describe('rounds and scoring', () => {
  function knockOut(sim: TanksSim, victim: number, by: number) {
    sim.tanks[victim].protect = 0;
    for (let k = 0; k < TUNING.armour; k++) sim.hurt(sim.tanks[victim], by, 'shell', 1, 0);
    sim.step([]);
  }

  it('gives +1 per knock-out, a point per tank you outlasted, and +2 for the last tank', () => {
    const sim = arena(4, [{ x: -15, z: -9 }, { x: 15, z: -9 }, { x: -15, z: 9 }, { x: 15, z: 9 }]);
    knockOut(sim, 3, 0);
    knockOut(sim, 2, 1);
    expect(sim.over).toBe(false);
    knockOut(sim, 1, 0);
    expect(sim.over).toBe(true);
    expect(sim.winner).toBe(0);
    const rp = roundPoints(sim.tanks);
    // tank 0: 2 knock-outs, outlasted 3, +2 bonus
    expect(rp.kos).toEqual([2, 1, 0, 0]);
    expect(rp.survival).toEqual([3, 2, 1, 0]);
    expect(rp.bonus).toEqual([2, 0, 0, 0]);
    expect(rp.total).toEqual([7, 3, 1, 0]);
  });

  it('a self knock-out earns nobody a point, and simultaneous exits count the same', () => {
    const sim = arena(4, [{ x: -15, z: -9 }, { x: 15, z: -9 }, { x: -15, z: 9 }, { x: 15, z: 9 }]);
    // Tank 1 blows itself up first.
    for (let k = 0; k < 3; k++) sim.hurt(sim.tanks[1], 1, 'shell', 1, 0);
    sim.step([]);
    expect(sim.tanks[1].kos).toBe(0);
    // Tanks 0 and 3 both go down on the same tick, to tank 2.
    for (const v of [0, 3]) for (let k = 0; k < 3; k++) sim.hurt(sim.tanks[v], 2, 'mortar', 1, 0);
    sim.step([]);
    expect(sim.over).toBe(true);
    expect(sim.winner).toBe(2);
    const rp = roundPoints(sim.tanks);
    expect(rp.survival).toEqual([1, 0, 3, 1]);
    expect(rp.total).toEqual([1, 0, 2 + 3 + 2, 1]);
  });

  it('ends when one tank is left, or when the time runs out (no bonus then)', () => {
    const sim = arena(3, [{ x: -15, z: -9 }, { x: 15, z: -9 }, { x: -15, z: 9 }]);
    run(sim, 60);
    expect(sim.over).toBe(false);
    expect(sim.timeLeft).toBeCloseTo(TUNING.roundTime - 1, 1);
    sim.timeLeft = 0.02;
    const ev = run(sim, 3);
    expect(sim.over).toBe(true);
    expect(sim.timedOut).toBe(true);
    expect(sim.winner).toBe(-1);
    expect(ev.some((e) => e.e === 'over')).toBe(true);
    const rp = roundPoints(sim.tanks);
    expect(rp.bonus).toEqual([0, 0, 0]);
    expect(rp.total).toEqual([0, 0, 0]);
  });

  it('the clock and shields wait while the round is locked (ready phase)', () => {
    const sim = new TanksSim(2, mulberry32(3));
    expect(sim.locked).toBe(true);
    const x0 = sim.tanks[0].x;
    run(sim, 120, () => [{ ...NONE, fire: 1, mortar: 1 }, NONE]);
    expect(sim.shells.length).toBe(0);
    expect(sim.mortars.length).toBe(0);
    expect(sim.timeLeft).toBe(TUNING.roundTime);
    expect(sim.tanks[0].protect).toBe(TUNING.protect);
    expect(sim.tanks[0].x).toBe(x0);
    sim.locked = false;
    run(sim, 125);
    expect(sim.tanks[0].protect).toBe(0);
    expect(sim.timeLeft).toBeLessThan(TUNING.roundTime);
  });

  it('sudden death in the last 20 seconds: every hit takes all remaining armour', () => {
    const sim = arena(2, [{ x: -10, z: 0, h: Math.PI / 2 }, { x: 8, z: 0 }]);
    sim.timeLeft = TUNING.sudden + 5;
    sim.step([]);
    expect(sim.suddenDeath).toBe(false);
    sim.timeLeft = TUNING.sudden - 1;
    expect(sim.suddenDeath).toBe(true);
    run(sim, 1, () => [{ ...NONE, fire: 1 }, NONE]);
    run(sim, 50);
    expect(sim.tanks[1].alive).toBe(false);
    expect(sim.winner).toBe(0);
  });

  it('a removed player vanishes and does not count', () => {
    const sim = arena(3, [{ x: -15, z: -9 }, { x: 15, z: -9 }, { x: -15, z: 9 }]);
    sim.remove(2);
    expect(sim.over).toBe(false);
    knockOutSimple(sim, 1);
    expect(sim.over).toBe(true);
    expect(sim.winner).toBe(0);
    const rp = roundPoints(sim.tanks);
    expect(rp.total[2]).toBe(0);
    expect(rp.total[0]).toBe(1 + 1 + 2);
    expect(rp.survival[0]).toBe(1);
  });

  it('flags armour as hearts', () => {
    expect(armourHearts(3)).toBe('♥♥♥');
    expect(armourHearts(2)).toBe('♥♥♡');
    expect(armourHearts(0)).toBe('♡♡♡');
  });
});

function knockOutSimple(sim: TanksSim, victim: number) {
  for (let k = 0; k < 3; k++) sim.hurt(sim.tanks[victim], 0, 'shell', 1, 0);
  sim.step([]);
}

describe('game length', () => {
  it('is three rounds, or one in a tournament', () => {
    expect(TANKS_ROUNDS).toBe(3);
    expect(TANKS_ROUNDS_SHORT).toBe(1);
    expect(howTo(false)).toHaveLength(3);
    expect(howTo(true)).toHaveLength(3);
    expect(howTo(false)[2]).toContain('3 rounds');
    expect(howTo(true)[2]).toContain('One round');
  });
});
