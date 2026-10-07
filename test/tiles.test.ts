import { describe, expect, it } from 'vitest';
import {
  BUFFER,
  CRACKED,
  CRACK_WARN,
  DASH_TIME,
  DT,
  FALL_RESPAWN,
  HOLE,
  HOLE_TIME,
  MOP_WARN,
  OK,
  ROLL_CD,
  ROUNDS,
  ROUNDS_SHORT,
  ROUND_S,
  ROUND_S_SHORT,
  SPLAT_CD,
  SPLAT_FLIGHT,
  STUN,
  TILE,
  TilesSim,
  gridFor,
  howTo,
  type TilesEvent,
  type TilesInput,
  type TilesOptions,
} from '../client/src/games/tiles/logic';
import { mulberry32 } from '../client/src/games/rng';

/** A sim with the scheduled tribulations switched off, so tests are about one thing at a time. */
function calm(n = 2, extra: TilesOptions = {}) {
  const sim = new TilesSim(n, { rng: mulberry32(7), cols: 16, rows: 10, length: 1e6, ...extra });
  return sim;
}

function put(sim: TilesSim, i: number, x: number, z: number, fx = 1, fz = 0) {
  const p = sim.players[i];
  p.x = x;
  p.z = z;
  p.vx = p.vz = 0;
  p.fx = fx;
  p.fz = fz;
}

function run(sim: TilesSim, seconds: number, input: (TilesInput | undefined)[] = [], first?: (TilesInput | undefined)[]) {
  const all: TilesEvent[] = [];
  const steps = Math.round(seconds / DT);
  for (let k = 0; k < steps; k++) all.push(...sim.step(k === 0 && first ? first : input));
  return all;
}

describe('layout', () => {
  it('scales the floor with the number of players', () => {
    expect(gridFor(2)).toEqual({ cols: 12, rows: 8 });
    expect(gridFor(4)).toEqual({ cols: 16, rows: 10 });
    expect(gridFor(8)).toEqual({ cols: 20, rows: 12 });
  });
  it('starts everyone on their own tile, facing the middle', () => {
    const sim = new TilesSim(5);
    expect(sim.counts).toEqual([1, 1, 1, 1, 1]);
    const tiles = new Set(sim.players.map((p) => sim.tileAt(p.x, p.z)));
    expect(tiles.size).toBe(5);
    for (const p of sim.players) expect(p.fx * p.x + p.fz * p.z).toBeLessThan(0.01);
  });
  it('maps points to tiles and back', () => {
    const sim = calm();
    const t = sim.tileAt(0.1, 0.1);
    const c = sim.centre(t);
    expect(Math.abs(c.x)).toBeCloseTo(TILE / 2);
    expect(sim.tileAt(c.x, c.z)).toBe(t);
    expect(sim.tileAt(-999, 999)).toBe((sim.rows - 1) * sim.cols);
  });
});

describe('painting', () => {
  it('walking paints the tile under your centre', () => {
    const sim = calm();
    const start = sim.centre(sim.idx(3, 4));
    put(sim, 0, start.x, start.z);
    const before = sim.counts[0];
    const ev = run(sim, 1, [{ x: 1, z: 0 }]);
    expect(sim.counts[0]).toBeGreaterThanOrEqual(before + 3);
    expect(sim.owner[sim.tileAt(sim.players[0].x, sim.players[0].z)]).toBe(0);
    expect(ev.filter((e) => e.t === 'paint').length).toBe(sim.counts[0] - before);
  });
  it('moves at about 6 m/s', () => {
    const sim = calm();
    put(sim, 0, -10, 0);
    run(sim, 1, [{ x: 1, z: 0 }]);
    expect(sim.players[0].x).toBeGreaterThan(-10 + 5.3);
    expect(sim.players[0].x).toBeLessThan(-10 + 6.05);
  });
  it('stealing: walking over another colour takes the tile', () => {
    const sim = calm();
    const t = sim.idx(5, 5);
    sim.setOwner(t, 1);
    const c = sim.centre(t);
    put(sim, 0, c.x, c.z);
    const ev = run(sim, 0.1);
    expect(sim.owner[t]).toBe(0);
    expect(ev.some((e) => e.t === 'paint' && e.tile === t && e.prev === 1)).toBe(true);
    expect(sim.counts[1]).toBe(1); // only the start tile left
  });
  it('keeps players inside the floor', () => {
    const sim = calm();
    put(sim, 0, 0, 0);
    run(sim, 6, [{ x: 1, z: 1 }]);
    expect(sim.players[0].x).toBeLessThanOrEqual(sim.W / 2);
    expect(sim.players[0].z).toBeLessThanOrEqual(sim.H / 2);
  });
  it('soft circles push players apart', () => {
    const sim = calm();
    put(sim, 0, 0, 0);
    put(sim, 1, 0.5, 0);
    run(sim, 0.2);
    expect(Math.hypot(sim.players[0].x - sim.players[1].x, sim.players[0].z - sim.players[1].z)).toBeGreaterThan(1.3);
  });
});

describe('Roll', () => {
  it('dashes about 8 m and paints a streak 3 tiles wide', () => {
    const sim = calm(2);
    const c = sim.centre(sim.idx(2, 5));
    put(sim, 0, c.x, c.z, 1, 0);
    // Wipe the starting tiles so the count is only the streak.
    for (let t = 0; t < sim.owner.length; t++) sim.setOwner(t, -1);
    run(sim, 0.01, [], [{ x: 0, z: 0, roll: true }]);
    expect(sim.players[0].dash).toBeGreaterThan(0);
    run(sim, DASH_TIME + 0.05);
    const p = sim.players[0];
    expect(p.x - c.x).toBeGreaterThan(7);
    expect(p.x - c.x).toBeLessThan(9.5);
    const rows = new Set<number>();
    for (let t = 0; t < sim.owner.length; t++) if (sim.owner[t] === 0) rows.add(sim.cz(t));
    expect([...rows].sort()).toEqual([4, 5, 6]);
    // 5 or 6 columns of 3 tiles
    expect(sim.counts[0]).toBeGreaterThanOrEqual(15);
    expect(sim.counts[0] % 3).toBe(0);
  });
  it('a vertical dash spreads sideways instead', () => {
    const sim = calm(2);
    const c = sim.centre(sim.idx(6, 2));
    put(sim, 0, c.x, c.z, 0, 1);
    for (let t = 0; t < sim.owner.length; t++) sim.setOwner(t, -1);
    run(sim, DASH_TIME + 0.05, [], [{ x: 0, z: 0, roll: true }]);
    const cols = new Set<number>();
    for (let t = 0; t < sim.owner.length; t++) if (sim.owner[t] === 0) cols.add(sim.cx(t));
    expect([...cols].sort((a, b) => a - b)).toEqual([5, 6, 7]);
  });
  it('has a cooldown', () => {
    const sim = calm(2);
    put(sim, 0, -8, 0, 1, 0);
    run(sim, 0.01, [], [{ x: 0, z: 0, roll: true }]);
    run(sim, DASH_TIME + 0.1);
    const x = sim.players[0].x;
    run(sim, 0.05, [], [{ x: 0, z: 0, roll: true }]);
    expect(sim.players[0].dash).toBe(0);
    expect(sim.players[0].x).toBeCloseTo(x, 0);
    run(sim, ROLL_CD);
    run(sim, 0.01, [], [{ x: 0, z: 0, roll: true }]);
    expect(sim.players[0].dash).toBeGreaterThan(0);
  });
  it('a press just before the cooldown ends still counts', () => {
    const sim = calm(2);
    put(sim, 0, -9, 0, 1, 0);
    run(sim, 0.01, [], [{ x: 0, z: 0, roll: true }]);
    run(sim, ROLL_CD - 0.01 - BUFFER / 2);
    run(sim, 0.01, [], [{ x: 0, z: 0, roll: true }]);
    expect(sim.players[0].dash).toBe(0);
    run(sim, BUFFER);
    expect(sim.players[0].rollCd).toBeGreaterThan(ROLL_CD - 1);
  });
  it('stuns and knocks back whoever it hits, once', () => {
    const sim = calm(3);
    put(sim, 0, -4, 0, 1, 0);
    put(sim, 1, 0, 0);
    put(sim, 2, -4, 12);
    const ev = run(sim, DASH_TIME + 0.05, [], [{ x: 0, z: 0, roll: true }]);
    expect(ev.filter((e) => e.t === 'stun' && e.p === 1 && e.kind === 'roll').length).toBe(1);
    expect(sim.players[1].stun).toBeGreaterThan(0);
    expect(sim.players[1].stun).toBeLessThanOrEqual(STUN);
    expect(sim.players[1].x).toBeGreaterThan(0.5);
    expect(sim.players[2].stun).toBe(0);
  });
});

describe('stun', () => {
  it('stunned players cannot walk or paint, then recover after about a second', () => {
    const sim = calm(3);
    put(sim, 0, -4, 0, 1, 0);
    put(sim, 1, 0, 0);
    put(sim, 2, -4, 12);
    run(sim, DASH_TIME + 0.05, [], [{ x: 0, z: 0, roll: true }]);
    const p = sim.players[1];
    const owned = sim.counts[1];
    const x = p.x;
    run(sim, 0.3, [undefined, { x: -1, z: 0 }]);
    expect(p.stun).toBeGreaterThan(0);
    expect(p.x).toBeGreaterThan(x - 0.01); // sliding forward, not walking back
    expect(sim.counts[1]).toBeLessThanOrEqual(owned + 2);
    run(sim, STUN);
    expect(p.stun).toBe(0);
    put(sim, 0, -9, -9);
    const x2 = p.x;
    run(sim, 0.5, [undefined, { x: -1, z: 0 }]);
    expect(p.x).toBeLessThan(x2 - 2);
  });
});

describe('Splat', () => {
  it('lands about 6 m ahead after 0.7 s and paints a 3×3 blob', () => {
    const sim = calm(2);
    for (let t = 0; t < sim.owner.length; t++) sim.setOwner(t, -1);
    const c = sim.centre(sim.idx(3, 5));
    put(sim, 0, c.x, c.z, 1, 0);
    const ev = run(sim, 0.01, [], [{ x: 0, z: 0, splat: true }]);
    const th = ev.find((e) => e.t === 'throw');
    expect(th).toBeTruthy();
    expect(sim.bombs.length).toBe(1);
    // Nothing yet while it flies.
    run(sim, SPLAT_FLIGHT - 0.1);
    expect(sim.counts[0]).toBeLessThan(9);
    const ev2 = run(sim, 0.2);
    const land = ev2.find((e) => e.t === 'land') as Extract<TilesEvent, { t: 'land' }>;
    expect(land).toBeTruthy();
    expect(land.x - c.x).toBeCloseTo(6, 0);
    const mine: number[] = [];
    for (let t = 0; t < sim.owner.length; t++) if (sim.owner[t] === 0) mine.push(t);
    // The thrower stands still, painting its own tile too.
    const blob = mine.filter((t) => Math.abs(sim.cx(t) - sim.cx(land.tile)) <= 1);
    expect(blob.length).toBe(9);
    expect(new Set(blob.map((t) => sim.cz(t)))).toEqual(new Set([4, 5, 6]));
    expect(sim.bombs.length).toBe(0);
  });
  it('steals tiles and stuns players it lands on, but not the thrower', () => {
    const sim = calm(3);
    const c = sim.centre(sim.idx(3, 5));
    put(sim, 0, c.x, c.z, 1, 0);
    const target = sim.centre(sim.idx(3 + 4, 5));
    put(sim, 1, target.x + 0.3, target.z);
    put(sim, 2, -9, -9);
    sim.setOwner(sim.idx(7, 5), 2);
    const ev = run(sim, SPLAT_FLIGHT + 0.1, [], [{ x: 0, z: 0, splat: true }]);
    expect(ev.some((e) => e.t === 'stun' && e.p === 1 && e.kind === 'splat')).toBe(true);
    expect(sim.players[1].stun).toBeGreaterThan(0);
    expect(sim.players[0].stun).toBe(0);
    expect(sim.owner[sim.idx(7, 5)]).toBe(0);
  });
  it('is clamped to the floor and has a 6 s cooldown', () => {
    const sim = calm(2);
    put(sim, 0, sim.W / 2 - 1, 0, 1, 0);
    run(sim, 0.01, [], [{ x: 0, z: 0, splat: true }]);
    expect(sim.bombs[0].tx).toBeLessThan(sim.W / 2);
    run(sim, SPLAT_FLIGHT + 0.1);
    run(sim, 0.01, [], [{ x: 0, z: 0, splat: true }]);
    expect(sim.bombs.length).toBe(0);
    run(sim, SPLAT_CD);
    run(sim, 0.01, [], [{ x: 0, z: 0, splat: true }]);
    expect(sim.bombs.length).toBe(1);
  });
  it('uses the stick direction when you hold one', () => {
    const sim = calm(2);
    put(sim, 0, 0, 0, 1, 0);
    run(sim, 0.01, [], [{ x: 0, z: 1, splat: true }]);
    const b = sim.bombs[0];
    expect(b.tz - 0).toBeGreaterThan(5);
    expect(Math.abs(b.tx)).toBeLessThan(1);
  });
});

describe('tribulations', () => {
  it('a tile cracks, crumbles into a hole and is replaced by a fresh, unclaimed tile', () => {
    const sim = calm(2);
    const t = sim.idx(4, 6);
    sim.setOwner(t, 1);
    sim.crack(t);
    expect(sim.kind[t]).toBe(CRACKED);
    run(sim, CRACK_WARN - 0.1);
    expect(sim.kind[t]).toBe(CRACKED);
    expect(sim.owner[t]).toBe(1);
    const ev1 = run(sim, 0.2);
    expect(sim.kind[t]).toBe(HOLE);
    expect(sim.owner[t]).toBe(-1);
    expect(ev1.some((e) => e.t === 'crumble' && e.tile === t)).toBe(true);
    run(sim, HOLE_TIME - 0.3);
    expect(sim.kind[t]).toBe(HOLE);
    const ev2 = run(sim, 0.5);
    expect(sim.kind[t]).toBe(OK);
    expect(sim.owner[t]).toBe(-1);
    expect(ev2.some((e) => e.t === 'fresh' && e.tile === t)).toBe(true);
  });
  it('holes cannot be painted, not even by a splat', () => {
    const sim = calm(2);
    for (let t = 0; t < sim.owner.length; t++) sim.setOwner(t, -1);
    const t = sim.idx(7, 5);
    sim.crack(t);
    run(sim, CRACK_WARN + 0.1);
    const c = sim.centre(sim.idx(3, 5));
    put(sim, 0, c.x, c.z, 1, 0);
    run(sim, SPLAT_FLIGHT + 0.1, [], [{ x: 0, z: 0, splat: true }]);
    expect(sim.kind[t]).toBe(HOLE);
    expect(sim.owner[t]).toBe(-1);
  });
  it('the middle of the round starts cracking tiles on its own', () => {
    const sim = new TilesSim(4, { rng: mulberry32(3) });
    const cracks: number[] = [];
    while (!sim.done) for (const e of sim.step([])) if (e.t === 'crack') cracks.push(sim.time);
    expect(cracks.length).toBeGreaterThanOrEqual(10);
    expect(Math.min(...cracks)).toBeGreaterThan(ROUND_S * 0.45);
  });
  it('walking onto a hole drops you out, and you come back at an edge after 2 s', () => {
    const sim = calm(2, { rng: mulberry32(11) });
    const t = sim.idx(8, 5);
    sim.crack(t);
    run(sim, CRACK_WARN + 0.1);
    const c = sim.centre(sim.idx(6, 5));
    put(sim, 0, c.x, c.z, 1, 0);
    const owned = sim.counts[0];
    const ev = run(sim, 1, [{ x: 1, z: 0 }]);
    expect(ev.some((e) => e.t === 'fall' && e.p === 0)).toBe(true);
    expect(sim.players[0].down).toBeGreaterThan(0);
    // Falling costs nothing else.
    expect(sim.counts[0]).toBeGreaterThanOrEqual(owned);
    const ev2 = run(sim, FALL_RESPAWN + 0.2);
    const re = ev2.find((e) => e.t === 'respawn') as Extract<TilesEvent, { t: 'respawn' }>;
    expect(re).toBeTruthy();
    expect(sim.players[0].down).toBe(0);
    const tile = sim.tileAt(re.x, re.z);
    const onEdge = sim.cx(tile) === 0 || sim.cz(tile) === 0 || sim.cx(tile) === sim.cols - 1 || sim.cz(tile) === sim.rows - 1;
    expect(onEdge).toBe(true);
    expect(sim.kind[tile]).not.toBe(HOLE);
  });
  it('a tile crumbling under your feet drops you in too', () => {
    const sim = calm(2);
    const t = sim.idx(8, 5);
    const c = sim.centre(t);
    put(sim, 0, c.x, c.z);
    sim.crack(t);
    const ev = run(sim, CRACK_WARN + 0.2);
    expect(ev.some((e) => e.t === 'fall' && e.p === 0)).toBe(true);
  });
  it('rolling across a hole is safe', () => {
    const sim = calm(2);
    const hole = sim.idx(5, 5);
    sim.crack(hole);
    run(sim, CRACK_WARN + 0.1);
    const c = sim.centre(sim.idx(3, 5));
    put(sim, 0, c.x, c.z, 1, 0);
    const ev = run(sim, DASH_TIME + 0.05, [], [{ x: 0, z: 0, roll: true }]);
    expect(ev.some((e) => e.t === 'fall')).toBe(false);
  });
  it('Babcia’s mop gives notice, then wipes two rows clean and shoves players', () => {
    const sim = calm(2);
    for (let t = 0; t < sim.owner.length; t++) sim.setOwner(t, t % 2);
    put(sim, 0, -20, -20);
    put(sim, 1, 0.2, sim.centre(sim.idx(0, 3)).z + TILE / 2);
    const ev: TilesEvent[] = [];
    sim.startMop(3, 1);
    ev.push(...run(sim, MOP_WARN - 0.2));
    // Telegraphed, nothing wiped yet.
    expect(sim.owner[sim.idx(15, 3)]).not.toBe(-1);
    expect(sim.mop?.active).toBe(false);
    ev.push(...run(sim, 0.4));
    expect(sim.mop?.active).toBe(true);
    ev.push(...run(sim, 3));
    expect(sim.mop).toBeNull();
    // (The shoved player repaints the tile they end up standing on.)
    let left = 0;
    for (let c = 0; c < sim.cols; c++) for (const r of [3, 4]) if (sim.owner[sim.idx(c, r)] !== -1) left++;
    expect(left).toBeLessThanOrEqual(1);
    expect(sim.owner[sim.idx(2, 2)]).not.toBe(-1);
    expect(sim.owner[sim.idx(2, 5)]).not.toBe(-1);
    expect(ev.some((e) => e.t === 'mopStart' && e.row === 3)).toBe(true);
    expect(ev.some((e) => e.t === 'stun' && e.p === 1 && e.kind === 'mop')).toBe(true);
    expect(ev.some((e) => e.t === 'mopEnd')).toBe(true);
  });
  it('schedules a mop sweep during a normal round', () => {
    const sim = new TilesSim(4, { rng: mulberry32(5) });
    let warns = 0;
    while (!sim.done) for (const e of sim.step([])) if (e.t === 'mopWarn') warns++;
    expect(warns).toBeGreaterThanOrEqual(2);
  });
});

describe('scoring and rounds', () => {
  it('counts tiles per player and ranks them', () => {
    const sim = calm(3);
    for (let t = 0; t < sim.owner.length; t++) sim.setOwner(t, -1);
    for (let k = 0; k < 5; k++) sim.setOwner(k, 2);
    for (let k = 5; k < 7; k++) sim.setOwner(k, 0);
    sim.setOwner(7, 1);
    expect(sim.scores()).toEqual([2, 1, 5]);
    expect(sim.ranking()).toEqual([2, 0, 1]);
    // Tied players keep join order.
    sim.setOwner(8, 1);
    expect(sim.ranking()).toEqual([2, 0, 1]);
  });
  it('the round ends after the round length', () => {
    const sim = new TilesSim(2, { rng: mulberry32(1) });
    expect(sim.length).toBe(ROUND_S);
    expect(sim.done).toBe(false);
    run(sim, ROUND_S - 1);
    expect(sim.done).toBe(false);
    run(sim, 1.1);
    expect(sim.done).toBe(true);
    expect(sim.left).toBe(0);
  });
  it('the tournament version is shorter and has one round', () => {
    expect(new TilesSim(2, { short: true }).length).toBe(ROUND_S_SHORT);
    expect(ROUND_S_SHORT).toBeLessThan(ROUND_S);
    expect(ROUNDS).toBe(2);
    expect(ROUNDS_SHORT).toBe(1);
    // Tribulations still start in its middle.
    const sim = new TilesSim(4, { short: true, rng: mulberry32(2) });
    let first = Infinity;
    while (!sim.done) for (const e of sim.step([])) if (e.t === 'crack') first = Math.min(first, sim.time);
    expect(first).toBeGreaterThan(ROUND_S_SHORT * 0.45);
    expect(first).toBeLessThan(ROUND_S_SHORT * 0.6);
  });
  it('someone who leaves loses their paint', () => {
    const sim = calm(3);
    for (let k = 0; k < 6; k++) sim.setOwner(k, 1);
    sim.remove(1);
    expect(sim.counts[1]).toBe(0);
    expect(sim.ranking()).not.toContain(1);
    run(sim, 0.2, [{ x: 1, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 0 }]);
    expect(sim.counts[1]).toBe(0);
  });
  it('keeps the tile counts consistent over a whole rowdy round', () => {
    const rnd = mulberry32(99);
    const sim = new TilesSim(6, { rng: mulberry32(4) });
    while (!sim.done) {
      const inputs: TilesInput[] = [];
      for (let i = 0; i < 6; i++) inputs.push({ x: Math.sin(sim.time * (1 + i * 0.3)), z: Math.cos(sim.time * (0.7 + i * 0.2)), roll: rnd() < 0.01, splat: rnd() < 0.01 });
      sim.step(inputs);
    }
    const recount = sim.players.map((_, i) => sim.owner.reduce((n, o) => n + (o === i ? 1 : 0), 0));
    expect(sim.counts).toEqual(recount);
    expect(sim.counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(30);
  });
});

describe('howTo', () => {
  it('gives three sentences', () => {
    expect(howTo(false)).toHaveLength(3);
    expect(howTo(true)).toHaveLength(3);
    expect(howTo(true)[2]).toContain('45');
  });
});
