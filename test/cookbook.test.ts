import { describe, expect, it } from 'vitest';
import {
  COOKBOOK_ROUNDS,
  COOKBOOK_ROUNDS_SHORT,
  CookbookSim,
  DASH_COOL,
  DASH_SPEED,
  DT,
  HOLD_TIME,
  MAX_PAGES,
  HOLE_KINDS,
  PAGE_CORNERS,
  PAGE_D,
  PAGE_HALF_D,
  PAGE_W,
  PLAYER_R,
  RETURN_TIME,
  WAIT_TIME,
  WALK_SPEED,
  holeAt,
  holeContains,
  holeCount,
  holeInRadius,
  holeOutRadius,
  holePolygon,
  holeReachable,
  holeSize,
  howTo,
  mulberry32,
  pageSpec,
  pointInCircle,
  pointInPolygon,
  pointInRect,
  reachDistance,
  resolveLanding,
  roundPoints,
  roundWinners,
  swingTime,
  type Hole,
  type PadIn,
} from '../client/src/games/cookbook/logic';

const hole = (over: Partial<Hole> = {}): Hole => ({ kind: 'circle', x: 8, z: 0, size: 1, rot: 0, aspect: 1, slide: null, ...over });
const none: PadIn = { x: 0, z: 0, dash: 0 };

/** Run until `pred` is true (or `max` seconds), feeding the same inputs every step. */
function run(sim: CookbookSim, secs: number, inputs: PadIn[] | ((t: number) => PadIn[]) = []) {
  const events = [];
  for (let i = 0; i < Math.round(secs / DT); i++) events.push(...sim.step(typeof inputs === 'function' ? inputs(i * DT) : inputs));
  return events;
}

/** A sim with one page of our own, so tests do not depend on the generator. */
function simWith(count: number, holes: Hole[], swing = 2) {
  const sim = new CookbookSim(count, mulberry32(1));
  sim.page = { n: 1, swing, hold: HOLD_TIME, holes };
  return sim;
}

describe('hole containment', () => {
  it('point in rect (rotated too)', () => {
    expect(pointInRect(1, 0.5, 0, 0, 2, 1)).toBe(true);
    expect(pointInRect(2.1, 0, 0, 0, 2, 1)).toBe(false);
    expect(pointInRect(0, 1.1, 0, 0, 2, 1)).toBe(false);
    // Turned a quarter: the long side now points along z.
    expect(pointInRect(0, 1.8, 0, 0, 2, 1, Math.PI / 2)).toBe(true);
    expect(pointInRect(1.8, 0, 0, 0, 2, 1, Math.PI / 2)).toBe(false);
  });

  it('point in circle', () => {
    expect(pointInCircle(3, 4, 0, 0, 5)).toBe(true);
    expect(pointInCircle(3, 4.1, 0, 0, 5)).toBe(false);
  });

  it('point in polygon, concave included', () => {
    const arrow = [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 4, z: 4 },
      { x: 2, z: 1 },
      { x: 0, z: 4 },
    ];
    expect(pointInPolygon(1, 0.5, arrow)).toBe(true);
    expect(pointInPolygon(2, 3, arrow)).toBe(false); // in the notch
    expect(pointInPolygon(-1, 1, arrow)).toBe(false);
  });

  it('every shape contains its centre and a ring of points just inside it, and nothing far outside', () => {
    for (const kind of HOLE_KINDS) {
      for (const rot of [0, 0.7, 2.2]) {
        const h = hole({ kind, rot, aspect: 1.4, size: 1.5 });
        expect(holeContains(h, h.x, h.z)).toBe(true);
        const inner = holeInRadius(h);
        const outer = holeOutRadius(h);
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          expect(holeContains(h, h.x + Math.cos(a) * inner * 0.98, h.z + Math.sin(a) * inner * 0.98), `${kind} inside`).toBe(true);
          expect(holeContains(h, h.x + Math.cos(a) * (outer + 0.05), h.z + Math.sin(a) * (outer + 0.05)), `${kind} outside`).toBe(false);
        }
      }
    }
  });

  it('shapes of the same size have about the same area', () => {
    const area = (h: Hole) => {
      const p = holePolygon(h);
      let a = 0;
      for (let i = 0; i < p.length; i++) {
        const q = p[(i + 1) % p.length];
        a += p[i].x * q.z - q.x * p[i].z;
      }
      return Math.abs(a) / 2;
    };
    const ref = Math.PI * 2 * 2;
    for (const kind of HOLE_KINDS) expect(area(hole({ kind, size: 2 })) / ref).toBeGreaterThan(0.9);
    for (const kind of HOLE_KINDS) expect(area(hole({ kind, size: 2 })) / ref).toBeLessThan(1.02);
  });

  it('the polygon of a rect agrees with its analytic test', () => {
    const h = hole({ kind: 'rect', aspect: 1.5, size: 1.4, rot: 0.6 });
    const poly = holePolygon(h);
    const rnd = mulberry32(3);
    for (let i = 0; i < 400; i++) {
      const x = h.x + (rnd() - 0.5) * 6;
      const z = h.z + (rnd() - 0.5) * 6;
      const a = pointInPolygon(x, z, poly);
      const b = holeContains(h, x, z);
      // Allow the odd point right on the edge.
      if (a !== b) {
        const near = Math.min(...poly.map((p) => Math.hypot(p.x - x, p.z - z)));
        expect(near).toBeLessThan(0.1);
      }
    }
  });

  it('a sliding hole ends where it says and starts away from there', () => {
    const h = hole({ slide: { dx: 3, dz: -1 } });
    expect(holeAt(h, 0)).toEqual({ x: 11, z: -1 });
    expect(holeAt(h, 1)).toEqual({ x: 8, z: 0 });
    // The final footprint is what counts at landing.
    expect(holeContains(h, 8, 0)).toBe(true);
    expect(holeContains(h, 11, -1)).toBe(false);
  });
});

describe('page schedule', () => {
  it('swing time shrinks and bottoms out', () => {
    expect(swingTime(1)).toBeCloseTo(2.8, 5);
    for (let n = 1; n < 30; n++) expect(swingTime(n + 1)).toBeLessThanOrEqual(swingTime(n));
    expect(swingTime(10)).toBeLessThan(swingTime(1) - 0.5);
    expect(swingTime(100)).toBeGreaterThanOrEqual(1.5);
    expect(swingTime(100)).toBeLessThan(2);
  });

  it('holes get fewer and smaller', () => {
    expect(holeCount(1)).toBeGreaterThanOrEqual(3);
    expect(holeCount(1)).toBeLessThanOrEqual(4);
    expect(holeCount(12)).toBeLessThanOrEqual(2);
    expect(holeCount(30)).toBe(1);
    for (let n = 1; n < 30; n++) expect(holeSize(n + 1)).toBeLessThanOrEqual(holeSize(n));
    // Early holes are big; late ones fit about two players and later one.
    expect(holeSize(1)).toBeGreaterThan(2);
    expect(holeSize(10)).toBeLessThan(1.3);
    expect(holeSize(40)).toBeLessThan(0.6);
    expect(holeSize(40) * 2).toBeLessThan(PLAYER_R * 2); // two centres a body apart do not both fit
  });

  it('generated pages follow the schedule', () => {
    const rnd = mulberry32(11);
    let prevMax = Infinity;
    for (let n = 1; n <= 25; n++) {
      const spec = pageSpec(n, rnd);
      expect(spec.n).toBe(n);
      expect(spec.swing).toBe(swingTime(n));
      expect(spec.holes.length).toBeGreaterThanOrEqual(1);
      expect(spec.holes.length).toBeLessThanOrEqual(holeCount(n));
      if (n <= 2) expect(spec.holes.length).toBeGreaterThanOrEqual(3);
      const biggest = Math.max(...spec.holes.map((h) => h.size));
      expect(biggest).toBeLessThanOrEqual(holeSize(n) * 1.07);
      expect(biggest).toBeLessThanOrEqual(prevMax * 1.15 + 1e-6);
      prevMax = Math.max(biggest, 0.55);
    }
  });

  it('is deterministic for a seed', () => {
    const a = pageSpec(7, mulberry32(5));
    const b = pageSpec(7, mulberry32(5));
    expect(a).toEqual(b);
  });

  it('holes stay on the page, do not overlap, and some late ones slide', () => {
    let slid = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = mulberry32(seed);
      for (let n = 1; n <= 24; n++) {
        const spec = pageSpec(n, rnd);
        spec.holes.forEach((h, i) => {
          const r = holeOutRadius(h);
          for (const p of [0, 0.5, 1]) {
            const at = holeAt(h, p);
            expect(at.x - r).toBeGreaterThanOrEqual(0);
            expect(at.x + r).toBeLessThanOrEqual(PAGE_W);
            expect(Math.abs(at.z) + r).toBeLessThanOrEqual(PAGE_HALF_D);
          }
          spec.holes.slice(i + 1).forEach((o) => {
            expect(Math.hypot(h.x - o.x, h.z - o.z)).toBeGreaterThan(holeOutRadius(o) + r);
          });
          if (h.slide) {
            slid++;
            expect(n).toBeGreaterThanOrEqual(6);
          }
        });
      }
    }
    expect(slid).toBeGreaterThan(20);
  });

  it('every hole is reachable from every corner in the swing time (analytic)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rnd = mulberry32(seed * 7);
      for (let n = 1; n <= 30; n++) {
        const spec = pageSpec(n, rnd);
        for (const h of spec.holes) {
          expect(holeReachable(h, spec.swing), `page ${n} seed ${seed}`).toBe(true);
          for (const c of PAGE_CORNERS) {
            expect(Math.hypot(c.x - h.x, c.z - h.z) - holeInRadius(h)).toBeLessThanOrEqual(reachDistance(spec.swing));
          }
        }
      }
    }
  });

  it('...and a real walker (with a dash) from each corner actually gets there in time', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const rnd = mulberry32(seed * 13);
      for (const n of [1, 3, 6, 9, 12, 15, 20, 30]) {
        const spec = pageSpec(n, rnd);
        for (const h of spec.holes) {
          for (const c of PAGE_CORNERS) {
            const sim = new CookbookSim(1, mulberry32(1));
            sim.page = { ...spec, holes: [h] };
            sim.phase = 'swing';
            sim.phaseT = 0;
            const p = sim.players[0];
            p.x = Math.max(0.45, Math.min(PAGE_W - 0.45, c.x));
            p.z = Math.max(-PAGE_HALF_D + 0.45, Math.min(PAGE_HALF_D - 0.45, c.z));
            let dashed = false;
            let landed = false;
            for (let t = 0; t < spec.swing + 0.5 && !landed; t += DT) {
              const dx = h.x - p.x;
              const dz = h.z - p.z;
              const d = Math.hypot(dx, dz);
              const m = Math.min(1, d / 0.6);
              const evs = sim.step([{ x: (dx / Math.max(d, 1e-6)) * m, z: (dz / Math.max(d, 1e-6)) * m, dash: dashed ? 0 : 1 }]);
              dashed = true;
              landed = evs.some((e) => e.t === 'land');
            }
            expect(landed).toBe(true);
            expect(p.alive, `page ${n} from corner (${c.x},${c.z}) to ${h.kind}@${h.x.toFixed(1)},${h.z.toFixed(1)}`).toBe(true);
          }
        }
      }
    }
  });

  it('a hole on the far side of the page is not reachable at the late swing time (the check has teeth)', () => {
    expect(holeReachable(hole({ x: 15, z: 0, size: 0.6 }), swingTime(20))).toBe(false);
    expect(holeReachable(hole({ x: 8, z: 0, size: 0.6 }), swingTime(20))).toBe(true);
    expect(holeReachable(hole({ x: 15, z: 0, size: 2 }), swingTime(1))).toBe(true);
  });
});

describe('squash resolution', () => {
  const holes = [hole({ x: 4, z: 0, size: 1 }), hole({ kind: 'rect', x: 12, z: 2, size: 1, aspect: 1.5 })];

  it('players inside a hole live, everyone else is squashed', () => {
    const r = resolveLanding(holes, [
      { x: 4, z: 0.5, alive: true },
      { x: 12, z: 2, alive: true },
      { x: 8, z: 0, alive: true },
      { x: 4, z: 1.2, alive: true },
    ]);
    expect(r.survivors).toEqual([0, 1]);
    expect(r.squashed).toEqual([2, 3]);
  });

  it('ignores players who are already out', () => {
    const r = resolveLanding(holes, [
      { x: 8, z: 0, alive: false },
      { x: 4, z: 0, alive: true },
    ]);
    expect(r.squashed).toEqual([]);
    expect(r.survivors).toEqual([1]);
  });

  it('the sim squashes the right players when the page lands', () => {
    const sim = simWith(3, [hole({ x: 8, z: 0, size: 1.5 })], 1);
    sim.players[0].x = 8;
    sim.players[0].z = 0;
    sim.players[1].x = 8.8;
    sim.players[1].z = 0.4;
    sim.players[2].x = 3;
    sim.players[2].z = 3;
    sim.begin();
    const ev = run(sim, WAIT_TIME + 1.1);
    const land = ev.find((e) => e.t === 'land');
    expect(land).toBeTruthy();
    if (land?.t === 'land') {
      expect(land.squashed).toEqual([2]);
      expect(land.survivors).toEqual([0, 1]);
    }
    expect(sim.players[2].alive).toBe(false);
    expect(sim.players[2].outPage).toBe(1);
    expect(sim.players[0].alive).toBe(true);
    expect(sim.landed).toBe(1);
  });

  it('after the hold the page flips back and the next page comes', () => {
    const sim = simWith(2, [hole({ x: 8, z: 0, size: 3 })], 1);
    sim.players.forEach((p, i) => ((p.x = 7 + i), (p.z = 0)));
    sim.begin();
    const ev = run(sim, WAIT_TIME + 1 + HOLD_TIME + RETURN_TIME + 0.2);
    expect(ev.filter((e) => e.t === 'page').map((e) => (e.t === 'page' ? e.n : 0))).toEqual([1, 2]);
    expect(sim.page.n).toBe(2);
    expect(sim.phase).toBe('swing');
  });
});

describe('movement and collisions', () => {
  it('walks at about 6 m/s with a little inertia', () => {
    const sim = new CookbookSim(1, mulberry32(1));
    const p = sim.players[0];
    p.x = 2;
    p.z = 0;
    sim.step([{ x: 1, z: 0, dash: 0 }]);
    expect(p.vx).toBeGreaterThan(0);
    expect(p.vx).toBeLessThan(WALK_SPEED); // not instant
    run(sim, 0.4, [{ x: 1, z: 0, dash: 0 }]);
    expect(p.vx).toBeCloseTo(WALK_SPEED, 1);
    const x0 = p.x;
    run(sim, 1, [{ x: 1, z: 0, dash: 0 }]);
    expect(p.x - x0).toBeCloseTo(WALK_SPEED, 0);
    run(sim, 0.6, [none]);
    expect(Math.abs(p.vx)).toBeLessThan(0.01);
  });

  it('+z of the stick walks towards +z and the page edge stops you', () => {
    const sim = new CookbookSim(1, mulberry32(1));
    run(sim, 3, [{ x: 0, z: 1, dash: 0 }]);
    expect(sim.players[0].z).toBeLessThanOrEqual(PAGE_HALF_D);
    expect(sim.players[0].z).toBeGreaterThan(PAGE_HALF_D - 1);
    run(sim, 6, [{ x: -1, z: 0, dash: 0 }]);
    expect(sim.players[0].x).toBeGreaterThanOrEqual(0);
    expect(sim.players[0].x).toBeLessThan(1);
  });

  it('a dash is a short fast burst with a cooldown', () => {
    const sim = new CookbookSim(1, mulberry32(1));
    const p = sim.players[0];
    p.x = 2;
    p.z = 0;
    const ev = sim.step([{ x: 1, z: 0, dash: 1 }]);
    expect(ev.some((e) => e.t === 'dash')).toBe(true);
    expect(p.vx).toBeCloseTo(DASH_SPEED, 3);
    // Pressing again straight away does nothing.
    run(sim, 0.5, [{ x: 1, z: 0, dash: 0 }]);
    const again = sim.step([{ x: 1, z: 0, dash: 1 }]);
    expect(again.some((e) => e.t === 'dash')).toBe(false);
    run(sim, DASH_COOL, [{ x: 0, z: 0, dash: 0 }]);
    const third = sim.step([{ x: 1, z: 0, dash: 1 }]);
    expect(third.some((e) => e.t === 'dash')).toBe(true);
  });

  it('overlapping players are pushed apart', () => {
    const sim = new CookbookSim(2, mulberry32(1));
    sim.players[0].x = 8;
    sim.players[0].z = 0;
    sim.players[1].x = 8.3;
    sim.players[1].z = 0;
    run(sim, 0.6, [none, none]);
    const d = Math.hypot(sim.players[0].x - sim.players[1].x, sim.players[0].z - sim.players[1].z);
    expect(d).toBeGreaterThan(PLAYER_R * 2 * 0.95);
    expect(sim.players[0].x).toBeLessThan(8);
    expect(sim.players[1].x).toBeGreaterThan(8.3);
  });

  it('players on exactly the same spot still separate', () => {
    const sim = new CookbookSim(2, mulberry32(1));
    for (const p of sim.players) {
      p.x = 8;
      p.z = 0;
    }
    run(sim, 0.6, [none, none]);
    expect(Math.hypot(sim.players[0].x - sim.players[1].x, sim.players[0].z - sim.players[1].z)).toBeGreaterThan(PLAYER_R * 1.8);
  });

  it('a crowded hole pushes people out: the hole is too small for everyone, so someone is squashed', () => {
    const sim = simWith(4, [hole({ x: 8, z: 0, size: 0.7 })], 1.5);
    sim.players.forEach((p, i) => {
      p.x = 8 + (i - 1.5) * 0.3;
      p.z = 0;
    });
    sim.begin();
    run(sim, WAIT_TIME + 1.6, () => sim.players.map((p) => ({ x: 8 - p.x, z: -p.z, dash: 0 })));
    expect(sim.landed).toBe(1);
    const alive = sim.players.filter((p) => p.alive).length;
    expect(alive).toBeGreaterThanOrEqual(1);
    expect(alive).toBeLessThanOrEqual(2);
  });

  it('a dash shoves the player it hits', () => {
    const sim = new CookbookSim(2, mulberry32(1));
    sim.players[0].x = 6;
    sim.players[0].z = 0;
    sim.players[1].x = 7.5;
    sim.players[1].z = 0;
    const ev = run(sim, 0.3, (t) => [{ x: 1, z: 0, dash: t === 0 ? 1 : 0 }, none]);
    expect(ev.some((e) => e.t === 'bump' && e.i === 1 && e.by === 0)).toBe(true);
    expect(sim.players[1].x).toBeGreaterThan(8.3);
  });

  it('players frozen in their holes while the page lies there', () => {
    const sim = simWith(1, [hole({ x: 8, z: 0, size: 3 })], 1);
    sim.players[0].x = 8;
    sim.players[0].z = 0;
    sim.begin();
    run(sim, WAIT_TIME + 1.05, [{ x: 1, z: 0, dash: 0 }]);
    expect(sim.phase).toBe('hold');
    const x = sim.players[0].x;
    run(sim, 0.3, [{ x: 1, z: 0, dash: 0 }]);
    expect(sim.players[0].x).toBe(x);
  });
});

describe('round end and points', () => {
  it('multi-player: points are the number squashed before you, +2 for the last one standing', () => {
    // A out on page 2, B out on page 5, C still standing.
    expect(roundPoints([2, 5, null], [false, false, false], false, 5)).toEqual([0, 1, 4]);
    expect(roundWinners([2, 5, null], [false, false, false], false)).toEqual([2]);
  });

  it('players squashed on the same page get the same points', () => {
    expect(roundPoints([1, 1, 3, null], [false, false, false, false], false, 3)).toEqual([0, 0, 2, 5]);
  });

  it('a tie on the last page: the tied players share the win', () => {
    // 4 players: one out on page 2; the other three all squashed together on page 6.
    expect(roundPoints([2, 6, 6, 6], [false, false, false, false], false, 6)).toEqual([0, 1 + 2, 1 + 2, 1 + 2]);
    expect(roundWinners([2, 6, 6, 6], [false, false, false, false], false)).toEqual([1, 2, 3]);
    // Everyone squashed on the very first page.
    expect(roundPoints([1, 1], [false, false], false, 1)).toEqual([2, 2]);
  });

  it('single player: points are the pages survived', () => {
    expect(roundPoints([8], [false], true, 8)).toEqual([7]);
    expect(roundPoints([1], [false], true, 1)).toEqual([0]);
    expect(roundWinners([8], [false], true)).toEqual([]);
  });

  it('players who left do not count', () => {
    expect(roundPoints([3, 1, null], [false, true, false], false, 3)).toEqual([0, 0, 3]);
  });

  it('the sim ends the round when one player is left', () => {
    const sim = simWith(3, [hole({ x: 8, z: 0, size: 2 })], 1);
    sim.players[0].x = 8;
    sim.players[0].z = 0;
    sim.players[1].x = 2;
    sim.players[1].z = 4;
    sim.players[2].x = 14;
    sim.players[2].z = -4;
    sim.begin();
    const ev = run(sim, WAIT_TIME + 1.2);
    expect(ev.filter((e) => e.t === 'over')).toHaveLength(1);
    expect(sim.over).toBe(true);
    const r = sim.results();
    expect(r.winners).toEqual([0]);
    expect(r.points).toEqual([2 + 2, 0, 0]);
    // The page flips back but no new one comes.
    run(sim, HOLD_TIME + RETURN_TIME + 0.5);
    expect(sim.phase).toBe('done');
    expect(sim.page.n).toBe(1);
  });

  it('everyone left squashed together: a tie, and the round ends', () => {
    const sim = simWith(2, [hole({ x: 8, z: 0, size: 1 })], 1);
    sim.players[0].x = 2;
    sim.players[1].x = 14;
    sim.begin();
    const ev = run(sim, WAIT_TIME + 1.2);
    expect(ev.some((e) => e.t === 'over')).toBe(true);
    const r = sim.results();
    expect(r.winners).toEqual([0, 1]);
    expect(r.points).toEqual([2, 2]);
  });

  it('the round carries on while two or more are standing', () => {
    const sim = simWith(3, [hole({ x: 8, z: 0, size: 3 })], 1);
    sim.players.forEach((p, i) => ((p.x = 7 + i * 0.9), (p.z = 0)));
    sim.begin();
    run(sim, WAIT_TIME + 1.2);
    expect(sim.over).toBe(false);
    expect(sim.aliveCount).toBe(3);
  });

  it('single player: the round ends when you are squashed, with your pages as the score', () => {
    const rnd = mulberry32(2);
    const sim = new CookbookSim(1, rnd);
    expect(sim.solo).toBe(true);
    sim.begin();
    // Walk into the nearest hole for the first few pages, then stop paying attention: we must end up squashed.
    let guard = 0;
    while (!sim.over && guard++ < 60 * 200) {
      if (sim.page.n > 6) {
        sim.step([none]);
        continue;
      }
      // Walk into the nearest hole of the page in the air.
      const p = sim.players[0];
      const spec = sim.phase === 'return' && sim.next ? sim.next : sim.page;
      let best = spec.holes[0];
      for (const h of spec.holes) if (Math.hypot(h.x - p.x, h.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z)) best = h;
      const dx = best.x - p.x;
      const dz = best.z - p.z;
      const d = Math.hypot(dx, dz);
      sim.step([{ x: (dx / Math.max(d, 1e-6)) * Math.min(1, d / 0.5), z: (dz / Math.max(d, 1e-6)) * Math.min(1, d / 0.5), dash: d > 6 ? 1 : 0 }]);
    }
    expect(sim.over).toBe(true);
    expect(sim.players[0].alive).toBe(false);
    const r = sim.results();
    // The page we were squashed on is not "survived".
    expect(r.points[0]).toBe(sim.players[0].outPage! - 1);
    expect(r.points[0]).toBeGreaterThan(3); // the early pages are generous
    expect(r.winners).toEqual([]);
  });

  it('a standing-still player is eventually squashed (rounds always end)', () => {
    const sim = new CookbookSim(2, mulberry32(9));
    sim.begin();
    let guard = 0;
    while (!sim.over && guard++ < 60 * 400) sim.step([none, none]);
    expect(sim.over).toBe(true);
  });

  it('a player who leaves mid-round counts as gone, and can end the round', () => {
    const sim = new CookbookSim(2, mulberry32(1));
    sim.begin();
    sim.remove(1);
    const ev = sim.step([none, none]);
    expect(ev.some((e) => e.t === 'over')).toBe(true);
    expect(sim.results().points[1]).toBe(0);
  });
});

describe('page cap', () => {
  const big = () => hole({ x: 8, z: 0, size: 3 });
  /** Park the sim just before the cap with a generous hole. */
  function atCap(count: number) {
    const sim = simWith(count, [big()], 1);
    sim.page = { n: MAX_PAGES, swing: 1, hold: HOLD_TIME, holes: [big()] };
    sim.players.forEach((p, i) => ((p.x = 7 + i * 1.3), (p.z = 0)));
    sim.begin();
    return sim;
  }

  it('is about 24', () => {
    expect(MAX_PAGES).toBeGreaterThanOrEqual(20);
    expect(MAX_PAGES).toBeLessThanOrEqual(30);
  });

  it('after the last page lands the round ends and everyone standing shares the win', () => {
    const sim = atCap(2);
    const ev = run(sim, WAIT_TIME + 1.1);
    expect(ev.filter((e) => e.t === 'over')).toHaveLength(1);
    expect(sim.over).toBe(true);
    expect(sim.aliveCount).toBe(2);
    const r = sim.results();
    expect(r.winners).toEqual([0, 1]);
    expect(r.points).toEqual([2, 2]);
    run(sim, HOLD_TIME + RETURN_TIME + 0.5);
    expect(sim.phase).toBe('done');
    expect(sim.page.n).toBe(MAX_PAGES);
  });

  it('players squashed earlier score below the survivors', () => {
    const sim = atCap(3);
    sim.players[2].alive = false;
    sim.players[2].outPage = 5;
    run(sim, WAIT_TIME + 1.1);
    expect(sim.results().points).toEqual([1 + 2, 1 + 2, 0]);
  });

  it('on your own you score the pages you survived, 24 at most', () => {
    const sim = atCap(1);
    sim.landed = MAX_PAGES - 1;
    run(sim, WAIT_TIME + 1.1);
    expect(sim.over).toBe(true);
    expect(sim.results().points).toEqual([MAX_PAGES]);
  });

  it('a perfect walker alone is stopped by the cap', () => {
    const sim = new CookbookSim(1, mulberry32(4));
    sim.begin();
    let guard = 0;
    while (!sim.over && guard++ < 60 * 400) {
      const p = sim.players[0];
      const spec = sim.phase === 'return' && sim.next ? sim.next : sim.page;
      let best = spec.holes[0];
      for (const h of spec.holes) if (Math.hypot(h.x - p.x, h.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z)) best = h;
      const dx = best.x - p.x;
      const dz = best.z - p.z;
      const d = Math.hypot(dx, dz);
      sim.step([{ x: (dx / Math.max(d, 1e-6)) * Math.min(1, d / 0.5), z: (dz / Math.max(d, 1e-6)) * Math.min(1, d / 0.5), dash: d > 6 ? 1 : 0 }]);
    }
    expect(sim.over).toBe(true);
    expect(sim.page.n).toBeLessThanOrEqual(MAX_PAGES);
    expect(sim.results().points[0]).toBeLessThanOrEqual(MAX_PAGES);
  });
});

describe('rounds', () => {
  it('a full game is three rounds, the tournament version one', () => {
    expect(COOKBOOK_ROUNDS).toBe(3);
    expect(COOKBOOK_ROUNDS_SHORT).toBe(1);
  });

  it('the intro text is three short sentences, and differs for the short version', () => {
    for (const short of [false, true]) {
      const t = howTo(short);
      expect(t).toHaveLength(3);
      for (const s of t) expect(s.length).toBeGreaterThan(10);
    }
    expect(howTo(true)).not.toEqual(howTo(false));
  });

  it('the page is 16 m by 11 m', () => {
    expect(PAGE_W).toBe(16);
    expect(PAGE_D).toBe(11);
  });
});
