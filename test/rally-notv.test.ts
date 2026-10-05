import { describe, expect, it } from 'vitest';
import { BRIDGE_WALL, SHAPES, TUNNEL_WALL, WALL, generateTrack, inRange, pointAt, project, riverCoords, waterLevel, type Track } from '../client/src/games/rally/track';
import { DT, LAPS, RallySim, hitEffect, itemWeights, selfEffect, type Car } from '../client/src/games/rally/sim';
import { gameInfo, gamesFor, playerCountProblem } from '../shared/protocol';
import { tiltSteer } from '../client/src/phone/tilt';

const ringDist = (t: Track, a: number, b: number) => Math.min(Math.abs(a - b), t.n - Math.abs(a - b));

describe('tunnels and river bridges', () => {
  const tracks = SHAPES.flatMap((shape) => Array.from({ length: 10 }, (_, k) => generateTrack(1000 + k * 37, shape)));

  it('puts a river or a tunnel on most tracks', () => {
    expect(tracks.filter((t) => t.river).length).toBeGreaterThan(tracks.length * 0.65);
    expect(tracks.filter((t) => t.tunnel).length).toBeGreaterThan(tracks.length * 0.55);
    expect(tracks.filter((t) => t.shape !== 'figure8' && !t.river).length).toBeLessThan(4);
  });

  it('bridges every river crossing, with the water well below the road', () => {
    for (const t of tracks) {
      if (!t.river) continue;
      const r = t.river;
      expect([2, 4]).toContain(r.bridges.length);
      for (const b of r.bridges) {
        const mid = (b.from + Math.floor(b.len / 2)) % t.n;
        expect(Math.abs(riverCoords(r, t.xs[b.at], t.zs[b.at]).d)).toBeLessThan(r.half);
        expect(t.hs[mid] - waterLevel(r, riverCoords(r, t.xs[mid], t.zs[mid]).s)).toBeGreaterThan(3);
        expect(t.wall[mid]).toBeCloseTo(BRIDGE_WALL, 5);
        expect(ringDist(t, b.at, 0)).toBeGreaterThan(60);
      }
      // Away from the bridges the road keeps clear of the water.
      for (let i = 0; i < t.n; i++) {
        if (r.bridges.some((b) => ringDist(t, i, b.at) < 30)) continue;
        expect(Math.abs(riverCoords(r, t.xs[i], t.zs[i]).d)).toBeGreaterThan(r.half + WALL);
      }
    }
  });

  it('digs tunnels where the hill has room, away from the start line', () => {
    for (const t of tracks) {
      if (!t.tunnel) continue;
      const { from, len, hill } = t.tunnel;
      expect(hill).toBeGreaterThan(14);
      expect(t.wall[(from + Math.floor(len / 2)) % t.n]).toBeCloseTo(TUNNEL_WALL, 5);
      expect(inRange(0, from - 20, len + 40, t.n)).toBe(false);
      expect(t.town && t.town.to - t.town.from >= t.n).toBeFalsy();
      for (let k = 0; k < len; k += 3) {
        const i = (from + k) % t.n;
        for (let j = 0; j < t.n; j += 3) {
          if (ringDist(t, i, j) < 70) continue;
          expect(Math.hypot(t.xs[i] - t.xs[j], t.zs[i] - t.zs[j])).toBeGreaterThan(hill + WALL);
        }
      }
    }
  });

  it('narrows the barriers gradually, and leaves them wide at the start', () => {
    for (const t of tracks) {
      expect(t.wall[0]).toBe(WALL);
      for (let i = 0; i < t.n; i++) {
        expect(t.wall[i]).toBeLessThanOrEqual(WALL);
        expect(Math.abs(t.wall[i] - t.wall[(i + 1) % t.n])).toBeLessThan(0.8);
      }
    }
  });

  it('keeps cars inside the tunnel walls', () => {
    const t = tracks.find((x) => x.tunnel)!;
    const sim = new RallySim(t, 1, LAPS, false);
    const c = sim.cars[0];
    place(sim, c, t.dist[t.tunnel!.from] - 20, 0, 30);
    let inside = 0;
    for (let k = 0; k < 400; k++) {
      c.input = { x: k % 120 < 60 ? 100 : -100, y: -100 };
      sim.step();
      expect(Math.abs(c.lateral)).toBeLessThanOrEqual(t.wall[c.hint] + 0.01);
      if (t.wall[c.hint] === TUNNEL_WALL) inside++;
    }
    expect(inside).toBeGreaterThan(0);
  });
});

/** Put car `c` at distance `d` along the track (and `lateral` to the left), facing forward. */
function place(sim: RallySim, c: Car, d: number, lateral = 0, speed = 0) {
  const p = pointAt(sim.track, d, lateral);
  const pr = project(sim.track, p.x, p.z);
  Object.assign(c, { x: p.x, z: p.z, h: pr.h, heading: p.heading, hint: pr.i, along: pr.along, lateral: pr.lateral, progress: d, speed });
}

function steps(sim: RallySim, n: number) {
  const hits = [];
  for (let k = 0; k < n; k++) hits.push(...sim.step().hits);
  return hits;
}

describe('new items', () => {
  const track = generateTrack(21, 'speedway');

  it('lobs a cabbage down the road that spins whoever is near it', () => {
    const sim = new RallySim(track, 3, LAPS, false);
    const [a, b, far] = sim.cars;
    place(sim, a, 100, 0, 0);
    place(sim, b, 125, 1, 0);
    place(sim, far, 300, 0, 0);
    a.item = 'bomb';
    sim.useItem(0);
    expect(sim.bombs).toHaveLength(1);
    const hits = steps(sim, 70);
    expect(hits).toEqual([{ idx: 1, by: 0, kind: 'bomb', blocked: false }]);
    expect(b.spin).toBeGreaterThan(0);
    expect(sim.bombs).toHaveLength(0);
    expect(sim.blasts).toHaveLength(1);
    steps(sim, 60);
    expect(sim.blasts).toHaveLength(0);
  });

  it('splashes beet juice on everyone ahead, and a pot lid keeps it off', () => {
    const sim = new RallySim(track, 3, LAPS, false);
    const [a, b, c] = sim.cars;
    place(sim, a, 300);
    place(sim, b, 200);
    place(sim, c, 100);
    a.shield = 5;
    c.item = 'beet';
    sim.useItem(2);
    const hits = steps(sim, 1);
    expect(b.ink).toBeGreaterThan(3);
    expect(b.spin).toBe(0);
    expect(a.ink).toBe(0);
    expect(a.shield).toBe(0);
    expect(c.ink).toBe(0);
    expect(hits.map((h) => [h.idx, h.blocked])).toEqual([
      [0, true],
      [1, false],
    ]);
    expect(sim.effect(b)).toBe('ink');
  });

  it('turns you into a ghost that steals an item and slips through butter', () => {
    const sim = new RallySim(track, 3, LAPS, false);
    const [a, b, c] = sim.cars;
    place(sim, a, 100, 0, 30);
    place(sim, b, 200);
    place(sim, c, 400);
    b.item = 'rocket';
    c.item = 'storm';
    a.item = 'ghost';
    sim.useItem(0);
    const ev = sim.step();
    expect(a.item).toBe('rocket');
    expect(b.item).toBeNull();
    expect(c.item).toBe('storm');
    expect(ev.steals).toEqual([{ idx: 0, from: 1, item: 'rocket' }]);
    expect(a.ghost).toBeGreaterThan(0);
    sim.slicks.push({ kind: 'butter', x: a.x, z: a.z, h: a.h, heading: 0, until: 99, owner: 2, safeUntil: 0 });
    expect(steps(sim, 5)).toEqual([]);
    expect(sim.slicks).toHaveLength(1);
  });

  it('drops a hay bale that stops the next car dead', () => {
    const sim = new RallySim(track, 2, LAPS, false);
    const [a, b] = sim.cars;
    place(sim, a, 200, 0, 0);
    place(sim, b, 150, 0, 40);
    a.item = 'hay';
    sim.useItem(0);
    expect(sim.slicks[0].kind).toBe('hay');
    place(sim, a, 600);
    let stopped = false;
    for (let k = 0; k < 120; k++) {
      const ahead = pointAt(sim.track, b.along + 8, 0);
      const d = Math.atan2(ahead.z - b.z, ahead.x - b.x) - b.heading;
      b.input = { x: Math.max(-100, Math.min(100, Math.atan2(Math.sin(d), Math.cos(d)) * 200)), y: -100 };
      if (sim.step().hits.some((h) => h.idx === 1 && h.kind === 'hay')) stopped = b.speed <= 5;
    }
    expect(stopped).toBe(true);
    expect(sim.slicks).toHaveLength(0);
  });

  it('hands the new items out by position', () => {
    const lead = itemWeights(0, 6);
    const last = itemWeights(1, 6);
    expect(lead.beet).toBe(0);
    expect(last.beet).toBeGreaterThan(0);
    expect(lead.hay).toBeGreaterThan(last.hay);
    expect(last.ghost).toBeGreaterThan(lead.ghost);
  });
});

describe('no-TV races', () => {
  const track = generateTrack(77, 'ring');

  it('lets the host follow cars driven on the phones', () => {
    const host = new RallySim(track, 2, LAPS, true, Math.random, { remote: () => true });
    const phone = new RallySim(track, 2, LAPS, true, Math.random, { authority: false, remote: (i) => i !== 1 });
    const me = phone.cars[1];
    let pickups = 0;
    for (let k = 0; k < 60 / DT && !host.cars[1].finished; k++) {
      const ahead = pointAt(track, me.along + 12, 0);
      let d = Math.atan2(ahead.z - me.z, ahead.x - me.x) - me.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      me.input = { x: Math.max(-100, Math.min(100, d * 200)), y: -100 };
      phone.step();
      // ~15 reports a second.
      if (k % 4 === 0) host.report(1, me.x, me.z, me.heading, me.speed);
      const ev = host.step();
      pickups += ev.pickups.length;
      if (host.cars[1].item) host.cars[1].item = null;
    }
    // The host counts laps from the reports and hands out items; the phone's copy doesn't.
    expect(host.lap(host.cars[1])).toBeGreaterThan(1);
    expect(Math.abs(host.cars[1].progress - me.progress)).toBeLessThan(10);
    expect(pickups).toBeGreaterThan(0);
    expect(me.item).toBeNull();
    // Car 0 never reported and sits on the grid.
    expect(host.cars[0].speed).toBe(0);
  });

  it('stops a remote car that goes quiet', () => {
    const sim = new RallySim(track, 1, LAPS, false, Math.random, { remote: () => true });
    const c = sim.cars[0];
    sim.report(0, c.x, c.z, c.heading, 30);
    for (let k = 0; k < 60; k++) sim.step();
    const moved = Math.hypot(c.x - pointAt(track, -6, 3.2).x, c.z - pointAt(track, -6, 3.2).z);
    expect(moved).toBeGreaterThan(5);
    expect(moved).toBeLessThan(30 * 0.25 + 1);
  });

  it('only pushes the local car in a bump', () => {
    const sim = new RallySim(track, 2, LAPS, false, Math.random, { authority: false, remote: (i) => i === 1 });
    const [mine, other] = sim.cars;
    place(sim, mine, 200, 0, 0);
    place(sim, other, 200.5, 0, 0);
    const before = { x: other.x, z: other.z };
    sim.step();
    expect(other.x).toBe(before.x);
    expect(other.z).toBe(before.z);
    expect(Math.hypot(mine.x - other.x, mine.z - other.z)).toBeGreaterThan(3);
  });

  it('applies item effects to a phone’s car the same way the host does', () => {
    const sim = new RallySim(track, 2, LAPS, false);
    const [a, b] = sim.cars;
    for (const item of ['boost', 'rocket', 'lid', 'ghost'] as const) {
      selfEffect(a, item);
      selfEffect(b, item);
    }
    for (const kind of ['butter', 'beet', 'storm', 'hay', 'bomb'] as const) {
      hitEffect(a, kind);
      hitEffect(b, kind);
    }
    const pick = (c: Car) => [c.boost, c.rocket, c.shield, c.ghost, c.spin, c.slow, c.ink, c.speed];
    expect(pick(a)).toEqual(pick(b));
  });

  it('offers only games that work without a TV, for up to 8', () => {
    expect(gamesFor(true).map((g) => g.id)).toEqual(['rally']);
    expect(gamesFor(false).length).toBeGreaterThan(1);
    const rally = gameInfo('rally');
    expect(playerCountProblem(rally, 8, 8, true)).toBeNull();
    expect(playerCountProblem(rally, 5, 5, false)).toMatch(/up to 4/);
    expect(playerCountProblem(gameInfo('quiz'), 3, 3, true)).toMatch(/needs a TV/);
  });
});

describe('tilt steering', () => {
  const g = 9.81;
  const deg = (d: number) => (d * Math.PI) / 180;
  /** Gravity reading (Android convention) for a phone turned `turn` degrees clockwise from `angle`. */
  const reading = (angle: number, turn: number) => {
    // World "up" in the phone's own coordinates.
    const r = deg(turn - angle);
    return { x: -g * Math.sin(r), y: g * Math.cos(r) };
  };
  it('is straight when the phone is upright, in portrait and landscape', () => {
    for (const angle of [0, 90, 270]) {
      const { x, y } = reading(angle, 0);
      expect(tiltSteer(x, y, angle, false)).toBe(0);
    }
  });
  it('steers right when turned clockwise, left when turned anticlockwise', () => {
    for (const angle of [0, 90, 270]) {
      const right = reading(angle, 15);
      const left = reading(angle, -15);
      expect(tiltSteer(right.x, right.y, angle, false)).toBeGreaterThan(0.3);
      expect(tiltSteer(left.x, left.y, angle, false)).toBeLessThan(-0.3);
      // iOS reports the same thing with the opposite sign.
      expect(tiltSteer(-right.x, -right.y, angle, true)).toBeCloseTo(tiltSteer(right.x, right.y, angle, false), 6);
      const hard = reading(angle, 60);
      expect(tiltSteer(hard.x, hard.y, angle, false)).toBe(1);
    }
  });
  it('ignores a phone lying flat', () => {
    expect(tiltSteer(0.3, 0.2, 0, false)).toBe(0);
  });
});
