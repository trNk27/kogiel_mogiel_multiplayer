import { describe, expect, it } from 'vitest';
import {
  GRID_H,
  GRID_W,
  KTUNING,
  KitchenSim,
  LEVELS,
  TICK_HZ,
  orderInterval,
  spawnPoints,
  expectedOrders,
  pointsFor,
  starThresholds,
  starsFor,
  type StationKind,
} from '../client/src/games/kitchen/logic';

function run(sim: KitchenSim, ms: number) {
  const ticks = Math.ceil((ms / 1000) * TICK_HZ);
  for (let i = 0; i < ticks; i++) sim.step();
}

/** A sim that is already serving (prep skipped). */
function playing(ids = ['a'], seed = 1, level = 0) {
  const sim = new KitchenSim(ids, seed, { level });
  run(sim, KTUNING.prepMs + 20);
  expect(sim.phase).toBe('play');
  return sim;
}

/** Put cook `id` on a floor tile next to station `n` of `kind` and face it. */
function goTo(sim: KitchenSim, id: string, kind: StationKind, n = 0) {
  const s = sim.stations.filter((x) => x.kind === kind)[n];
  const c = sim.cook(id)!;
  for (const [dx, dy] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ]) {
    const fx = s.x + dx;
    const fy = s.y + dy;
    if (fx < 0 || fy < 0 || fx >= GRID_W || fy >= GRID_H || sim.stationAt(fx, fy)) continue;
    c.x = fx + 0.5;
    c.y = fy + 0.5;
    c.vx = c.vy = 0;
    c.fx = -dx;
    c.fy = -dy;
    return s;
  }
  throw new Error(`no floor next to ${kind}`);
}

function act(sim: KitchenSim, id: string, kind: StationKind, n = 0) {
  goTo(sim, id, kind, n);
  return sim.act(id);
}

/** Finish the minigame the cook just started. */
function finishMini(sim: KitchenSim, id: string) {
  const c = sim.cook(id)!;
  expect(c.mini).not.toBeNull();
  expect(sim.miniDone(id, c.mini!.id)).toBe(true);
}

describe.each(LEVELS.map((l, i) => [l.name, i] as const))('kitchen layout: %s', (_name, level) => {
  const L = LEVELS[level];
  it('is a closed rectangle of stations and walls around a connected floor', () => {
    expect(L.layout.length).toBe(GRID_H);
    expect(L.layout.every((r) => r.length === GRID_W)).toBe(true);
    const sim = new KitchenSim(['a'], 1, { level });
    const solid = (x: number, y: number) => !!sim.stationAt(x, y) || sim.isWall(x, y);
    for (let x = 0; x < GRID_W; x++) expect(solid(x, 0) && solid(x, GRID_H - 1)).toBe(true);
    for (let y = 0; y < GRID_H; y++) expect(solid(0, y) && solid(GRID_W - 1, y)).toBe(true);
    // Flood fill the floor from the first cook.
    const c = sim.cook('a')!;
    const seen = new Set<number>();
    const stack = [[Math.floor(c.x), Math.floor(c.y)]];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      const k = y * GRID_W + x;
      if (seen.has(k) || solid(x, y)) continue;
      seen.add(k);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    const floor = L.layout.join('').split('').filter((ch) => ch === '.').length;
    expect(seen.size).toBe(floor);
    // Every non-plain station touches the floor.
    for (const s of sim.stations) {
      if (s.kind === 'counter') continue;
      const touches = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => seen.has((s.y + dy) * GRID_W + s.x + dx));
      expect(touches, `${s.kind} at ${s.x},${s.y}`).toBe(true);
    }
  });

  it('has every station its recipes need and room for 8 cooks', () => {
    const sim = new KitchenSim(['a'], 1, { level });
    const count = (k: StationKind) => sim.stations.filter((s) => s.kind === k).length;
    for (const k of ['flour', 'roll', 'fold', 'stove', 'sink', 'rack', 'hatch', 'return', 'trash'] as const) expect(count(k), k).toBeGreaterThan(0);
    const crates = sim.stations.filter((s) => s.kind === 'crate').map((s) => s.crate);
    expect(crates).toEqual(L.fillings);
    expect(count('pan') > 0).toBe(L.fried > 0);
    const spawns = spawnPoints(L.layout);
    expect(spawns.length).toBe(8);
    expect(new Set(spawns.map((p) => p.join())).size).toBe(8);
  });
});

describe('kitchen rules', () => {
  it('cooks a full plate of pierogi from flour to the hatch', () => {
    const sim = playing();
    expect(sim.orders.map((o) => o.f)).toEqual(['potato']);
    const rack = sim.stations.find((s) => s.kind === 'rack')!;
    const plates = rack.count;

    expect(act(sim, 'a', 'flour')).toBe(true);
    expect(sim.cook('a')!.hold).toEqual({ k: 'flour' });
    expect(act(sim, 'a', 'roll')).toBe(true); // put flour down
    expect(sim.hint('a')).toBe('Roll dough');
    expect(sim.act('a')).toBe(true); // start rolling
    expect(sim.viewState('a')!.mini?.kind).toBe('roll');
    finishMini(sim, 'a');
    expect(sim.act('a')).toBe(true); // pick up dough
    expect(sim.cook('a')!.hold).toEqual({ k: 'dough' });

    act(sim, 'a', 'fold'); // dough on the board
    act(sim, 'a', 'crate', 0); // potato
    expect(sim.cook('a')!.hold).toEqual({ k: 'fill', f: 'potato' });
    act(sim, 'a', 'fold'); // filling on the board
    expect(sim.hint('a')).toBe('Make pierogi');
    sim.act('a');
    expect(sim.viewState('a')!.mini).toMatchObject({ kind: 'fold', f: 'potato' });
    finishMini(sim, 'a');
    sim.act('a');
    expect(sim.cook('a')!.hold).toEqual({ k: 'raw', f: 'potato' });

    act(sim, 'a', 'stove');
    expect(sim.hint('a')).toBe('Boil pierogi');
    sim.act('a');
    finishMini(sim, 'a');
    expect(sim.stations.find((s) => s.kind === 'stove')!.pot?.state).toBe('cooked');
    expect(sim.hint('a')).toBeNull(); // needs a plate

    act(sim, 'a', 'rack');
    expect(rack.count).toBe(plates - 1);
    act(sim, 'a', 'stove');
    expect(sim.cook('a')!.hold).toEqual({ k: 'plate', f: 'potato' });

    goTo(sim, 'a', 'hatch');
    expect(sim.hint('a')).toBe('Serve!');
    sim.act('a');
    expect(sim.served).toBe(1);
    expect(sim.score).toBeGreaterThanOrEqual(KTUNING.basePoints);
    expect(sim.score).toBeLessThanOrEqual(KTUNING.basePoints + KTUNING.tipPoints);
    expect(sim.cook('a')!.hold).toBeNull();
    expect(sim.cook('a')!.jobs).toBe(3);

    // The plate comes back dirty, gets washed and goes back on the rack.
    const ret = sim.stations.find((s) => s.kind === 'return')!;
    expect(ret.count).toBe(0);
    run(sim, KTUNING.dirtyReturnMs + 50);
    expect(ret.count).toBe(1);
    act(sim, 'a', 'return');
    expect(sim.cook('a')!.hold).toEqual({ k: 'dirty', n: 1 });
    act(sim, 'a', 'sink');
    expect(sim.hint('a')).toBe('Wash a plate');
    sim.act('a');
    finishMini(sim, 'a');
    expect(rack.count).toBe(plates);
  });

  it('fries pierogi in a pan for fried orders', () => {
    const sim = playing(['a'], 3, 2);
    sim.orders = [{ id: 99, f: 'meat', fried: true, born: sim.t, ttl: sim.tuning.orderTtlMs }];
    const c = sim.cook('a')!;
    c.hold = { k: 'raw', f: 'meat' };
    act(sim, 'a', 'pan');
    expect(sim.hint('a')).toBe('Fry pierogi');
    sim.act('a');
    expect(sim.viewState('a')!.mini).toMatchObject({ kind: 'fry', f: 'meat' });
    finishMini(sim, 'a');
    c.hold = { k: 'plate' };
    expect(sim.hint('a')).toBe('Plate up');
    sim.act('a');
    expect(c.hold).toEqual({ k: 'plate', f: 'meat', fried: true });
    // A boiled plate of the same filling doesn't count as fried.
    goTo(sim, 'a', 'hatch');
    c.hold = { k: 'plate', f: 'meat' };
    expect(sim.hint('a')).toBe('Not ordered');
    c.hold = { k: 'plate', f: 'meat', fried: true };
    expect(sim.hint('a')).toBe('Serve!');
    sim.act('a');
    expect(sim.score).toBeGreaterThanOrEqual(KTUNING.basePoints + KTUNING.friedBonus);
  });

  it('burns fried pierogi left in the pan', () => {
    const sim = playing(['a'], 3, 2);
    sim.cook('a')!.hold = { k: 'raw', f: 'berry' };
    act(sim, 'a', 'pan');
    sim.act('a');
    finishMini(sim, 'a');
    run(sim, KTUNING.overcookMs + 100);
    expect(sim.stations.find((s) => s.kind === 'pan')!.pot?.state).toBe('mushy');
    expect(sim.hint('a')).toBe('Scrape the pan');
  });

  it('ignores the button during the prep countdown', () => {
    const sim = new KitchenSim(['a']);
    expect(sim.phase).toBe('prep');
    expect(act(sim, 'a', 'flour')).toBe(false);
    expect(sim.cook('a')!.hold).toBeNull();
  });

  it('locks a station while somebody works there', () => {
    const sim = playing(['a', 'b']);
    act(sim, 'a', 'flour');
    act(sim, 'a', 'roll');
    sim.act('a'); // rolling
    const miniId = sim.cook('a')!.mini!.id;
    const board = sim.stations.find((s) => s.kind === 'roll')!;
    expect(board.busy).toBe('a');

    // b can't touch it; a is frozen.
    const bPos = goTo(sim, 'b', 'roll');
    expect(bPos).toBe(board);
    expect(sim.act('b')).toBe(false);

    // A stale or foreign minigame id does nothing.
    expect(sim.miniDone('a', miniId + 1)).toBe(false);
    expect(sim.miniDone('b', miniId)).toBe(false);

    sim.miniCancel('a', miniId);
    expect(board.busy).toBeNull();
    expect(board.item).toEqual({ k: 'flour' });
    expect(sim.act('b')).toBe(true); // b can roll now
    expect(sim.cook('b')!.mini?.kind).toBe('roll');
  });

  it('cancels a minigame when the phone disconnects', () => {
    const sim = playing();
    act(sim, 'a', 'flour');
    act(sim, 'a', 'roll');
    sim.act('a');
    sim.pause('a');
    expect(sim.cook('a')!.mini).toBeNull();
    expect(sim.stations.find((s) => s.kind === 'roll')!.busy).toBeNull();
  });

  it('rejects dishes nobody ordered', () => {
    const sim = playing();
    sim.cook('a')!.hold = { k: 'plate', f: 'berry' };
    goTo(sim, 'a', 'hatch');
    expect(sim.hint('a')).toBe('Not ordered');
    sim.act('a');
    expect(sim.cook('a')!.hold).toEqual({ k: 'plate', f: 'berry' });
    expect(sim.drain().some((e) => e.e === 'reject')).toBe(true);
    expect(sim.score).toBe(0);
  });

  it('expires orders with a penalty, never below zero', () => {
    const sim = playing();
    sim.score = 10;
    run(sim, KTUNING.orderTtlMs + 100);
    expect(sim.expired).toBeGreaterThanOrEqual(1);
    expect(sim.score).toBe(0);
  });

  it('turns cooked pierogi to mush if nobody plates them', () => {
    const sim = playing();
    sim.cook('a')!.hold = { k: 'raw', f: 'meat' };
    act(sim, 'a', 'stove');
    sim.act('a');
    finishMini(sim, 'a');
    const stove = sim.stations.find((s) => s.kind === 'stove')!;
    run(sim, KTUNING.overcookMs + 100);
    expect(stove.pot?.state).toBe('mushy');
    expect(sim.hint('a')).toBe('Scrape the pot');
    sim.act('a');
    expect(stove.pot).toBeNull();
  });

  it('bins ingredients and food but never plates', () => {
    const sim = playing();
    const c = sim.cook('a')!;
    c.hold = { k: 'raw', f: 'cabbage' };
    act(sim, 'a', 'trash');
    expect(c.hold).toBeNull();
    c.hold = { k: 'plate', f: 'cabbage' };
    act(sim, 'a', 'trash');
    expect(c.hold).toEqual({ k: 'plate' });
    expect(act(sim, 'a', 'trash')).toBe(false);
    c.hold = { k: 'dirty', n: 2 };
    expect(act(sim, 'a', 'trash')).toBe(false);
  });

  it('uses counters as storage', () => {
    const sim = playing();
    const c = sim.cook('a')!;
    c.hold = { k: 'dough' };
    act(sim, 'a', 'counter', 3);
    expect(c.hold).toBeNull();
    expect(sim.hint('a')).toBe('Pick up dough');
    sim.act('a');
    expect(c.hold).toEqual({ k: 'dough' });
  });

  it('ends service after the round and freezes everyone', () => {
    const sim = playing();
    sim.setStick('a', 1, 0);
    run(sim, sim.tuning.roundMs + 100);
    expect(sim.phase).toBe('over');
    const c = sim.cook('a')!;
    const x = c.x;
    run(sim, 500);
    expect(c.x).toBeCloseTo(x, 3);
  });
});

describe('kitchen movement', () => {
  it('never walks through counters', () => {
    const sim = playing();
    const c = sim.cook('a')!;
    for (const [sx, sy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [0.7, 0.7],
    ]) {
      sim.setStick('a', sx, sy);
      run(sim, 4000);
      expect(sim.stationAt(Math.floor(c.x), Math.floor(c.y))).toBeNull();
      expect(c.x).toBeGreaterThan(1 + KTUNING.radius - 1e-6);
      expect(c.y).toBeGreaterThan(1 + KTUNING.radius - 1e-6);
      expect(c.x).toBeLessThan(GRID_W - 1 - KTUNING.radius + 1e-6);
      expect(c.y).toBeLessThan(GRID_H - 1 - KTUNING.radius + 1e-6);
    }
  });

  it('pushes cooks apart', () => {
    const sim = playing(['a', 'b']);
    const a = sim.cook('a')!;
    const b = sim.cook('b')!;
    a.x = 7.5;
    a.y = 5.5;
    b.x = 7.6;
    b.y = 5.5;
    run(sim, 100);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(KTUNING.radius * 2 - 1e-3);
  });

  it('normalises the joystick', () => {
    const sim = playing();
    sim.setStick('a', 3, 4);
    const c = sim.cook('a')!;
    expect(Math.hypot(c.sx, c.sy)).toBeCloseTo(1);
    sim.setStick('a', NaN, 0.5);
    expect(c.sx).toBe(0);
  });
});

describe('kitchen scoring', () => {
  it('gives a bigger tip for faster service', () => {
    expect(pointsFor(KTUNING.orderTtlMs, KTUNING.orderTtlMs)).toBe(KTUNING.basePoints + KTUNING.tipPoints);
    expect(pointsFor(0, KTUNING.orderTtlMs)).toBe(KTUNING.basePoints);
  });

  it('sends orders faster on harder difficulties', () => {
    for (let d = 1; d < 5; d++) expect(orderInterval(4, d + 1)).toBeLessThan(orderInterval(4, d));
    const easy = new KitchenSim(['a'], 1, { difficulty: 1 });
    const chaos = new KitchenSim(['a'], 1, { difficulty: 5 });
    expect(easy.tuning.orderTtlMs).toBeGreaterThan(chaos.tuning.orderTtlMs);
    expect(easy.thresholds[2]).toBeLessThan(chaos.thresholds[2]);
  });

  it('only orders what the level teaches', () => {
    for (let level = 0; level < LEVELS.length; level++) {
      const sim = playing(['a', 'b', 'c', 'd', 'e', 'f'], 7, level);
      const seen = new Set<string>();
      let fried = 0;
      for (let i = 0; i < sim.tuning.roundMs / 500; i++) {
        run(sim, 500);
        for (const o of sim.orders) seen.add(o.f);
        for (const e of sim.drain()) if (e.e === 'order' && e.fried) fried++;
        sim.orders = []; // keep the board empty so new ones keep coming
      }
      expect([...seen].every((f) => LEVELS[level].fillings.includes(f as never))).toBe(true);
      if (level === 0) expect([...seen]).toEqual(['potato']);
      expect(fried > 0).toBe(LEVELS[level].fried > 0);
    }
  });

  it('asks more of bigger teams', () => {
    let prev = 0;
    for (let n = 1; n <= 8; n++) {
      const t = starThresholds(n);
      expect(t[0]).toBeLessThan(t[1]);
      expect(t[1]).toBeLessThan(t[2]);
      expect(t[2]).toBeGreaterThanOrEqual(prev);
      prev = t[2];
      expect(expectedOrders(n)).toBeGreaterThan(0);
    }
    expect(starsFor(0, starThresholds(2))).toBe(0);
    expect(starsFor(1e6, starThresholds(2))).toBe(3);
  });

  it('keeps spawning orders through the round', () => {
    const sim = playing(['a', 'b', 'c', 'd']);
    let spawned = 1;
    for (let i = 0; i < sim.tuning.roundMs / 100; i++) {
      run(sim, 100);
      spawned += sim.drain().filter((e) => e.e === 'order').length;
    }
    expect(spawned).toBeGreaterThanOrEqual(expectedOrders(4, sim.tuning.roundMs) - 1);
  });
});
