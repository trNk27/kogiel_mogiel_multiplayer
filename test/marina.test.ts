import { describe, expect, it } from 'vitest';
import {
  Autopilot,
  BOAT_HL,
  BOAT_HW,
  BUMP_V,
  CLEAN_POINTS,
  DOCK_HOLD,
  DOCK_SPEED,
  HOLD_DECAY,
  DT,
  HALF_W,
  LAST_BOAT_S,
  LEVELS,
  MAX_BUMP_PENALTY,
  MarinaSim,
  PLACE_POINTS,
  QUAY_Z,
  SHORE_Z,
  TUNING,
  corners,
  crossings,
  fwd,
  howTo,
  levelFor,
  makeLayout,
  nearPoints,
  ordinal,
  parkQuality,
  placePoints,
  pointInRect,
  rectCircle,
  rectInside,
  rectRect,
  roundScore,
  soloTimePoints,
  stbd,
  windShelter,
  type Boat,
  type MarinaEvent,
} from '../client/src/games/marina/logic';
import { mulberry32 } from '../client/src/games/rng';

/** Step the sim for `seconds`; `each(sim)` runs before every step (to steer). */
function run(sim: MarinaSim, seconds: number, each: (sim: MarinaSim) => void = () => {}) {
  const all: MarinaEvent[] = [];
  for (let k = 0; k < Math.round(seconds / DT) && !sim.over; k++) {
    each(sim);
    all.push(...sim.step());
  }
  return all;
}

/** Put boat i at rest exactly in the middle of its berth, lined up. */
function parkInPlace(sim: MarinaSim, i: number, dx = 0, da = 0) {
  const b = sim.boats[i];
  const B = sim.layout.berths[i];
  const s = stbd(B.a);
  b.x = B.x + s.x * dx;
  b.z = B.z + s.z * dx;
  b.a = B.a + da;
  b.vx = b.vz = b.w = 0;
}

const speed = (b: Boat) => Math.hypot(b.vx, b.vz);
const surge = (b: Boat) => b.vx * fwd(b.a).x + b.vz * fwd(b.a).z;

describe('geometry', () => {
  it('corners, points in rectangles and rectangles inside rectangles', () => {
    const r = { x: 0, z: 0, a: 0, hl: 2, hw: 1 };
    const cs = corners(r);
    expect(cs).toHaveLength(4);
    for (const c of cs) expect(pointInRect(c, r)).toBe(true);
    expect(pointInRect({ x: 1.1, z: 0 }, r)).toBe(false);
    expect(pointInRect({ x: 0.9, z: 1.9 }, r)).toBe(true);
    expect(rectInside({ x: 0, z: 0, a: 0, hl: 1.5, hw: 0.8 }, r)).toBe(true);
    expect(rectInside({ x: 0.3, z: 0, a: 0, hl: 1.5, hw: 0.8 }, r)).toBe(false);
    // Turned 90° it no longer fits.
    expect(rectInside({ x: 0, z: 0, a: Math.PI / 2, hl: 1.5, hw: 0.8 }, r)).toBe(false);
  });

  it('heading and starboard: a = π points up the screen (−z) with starboard to the right (+x)', () => {
    expect(fwd(Math.PI).z).toBeCloseTo(-1);
    expect(stbd(Math.PI).x).toBeCloseTo(1);
    expect(stbd(Math.PI / 2).z).toBeCloseTo(1);
  });

  it('rectangle contacts point from A to B, with the right depth', () => {
    const A = { x: 0, z: 0, a: 0, hl: 2, hw: 1 };
    const B = { x: 1.8, z: 0, a: 0, hl: 2, hw: 1 };
    const c = rectRect(A, B)!;
    expect(c).not.toBeNull();
    expect(c.nx).toBeCloseTo(1);
    expect(c.depth).toBeCloseTo(0.2);
    expect(rectRect(A, { ...B, x: 2.1 })).toBeNull();
    const cc = rectCircle(A, { x: 0, z: 2.3, r: 0.5 })!;
    expect(cc.nz).toBeCloseTo(1);
    expect(cc.depth).toBeCloseTo(0.2);
    expect(rectCircle(A, { x: 0, z: 2.6, r: 0.5 })).toBeNull();
  });
});

describe('layout', () => {
  it('gives every player their own berth, in open water, clear of every pier and moored boat', () => {
    for (let level = 0; level < LEVELS.length; level++)
      for (const n of [1, 2, 5, 8])
        for (let seed = 1; seed <= 6; seed++) {
          const L = makeLayout(n, level, mulberry32(seed));
          expect(L.berths).toHaveLength(n);
          for (const [i, b] of L.berths.entries()) {
            expect(b.owner).toBe(i);
            expect(Math.abs(b.x) + b.hl).toBeLessThan(HALF_W);
            expect(b.z - b.hl).toBeGreaterThanOrEqual(QUAY_Z - 0.01);
            // Room for the boat in the lines.
            expect(b.hw).toBeGreaterThan(BOAT_HW + 0.2);
            expect(b.hl).toBeGreaterThan(BOAT_HL + 0.3);
            // A boat parked in the middle touches nothing solid.
            const parked = { x: b.x, z: b.z, a: b.a, hl: BOAT_HL, hw: BOAT_HW };
            for (const s of L.solids) expect(rectRect(parked, s)).toBeNull();
            for (const o of L.berths) if (o !== b) expect(rectRect(b, o)).toBeNull();
          }
          for (const m of L.moored) for (const b of L.berths) expect(rectRect(m, b)).toBeNull();
          // Starts are clear of everything too.
          for (const s of L.starts) {
            const r = { ...s, hl: BOAT_HL, hw: BOAT_HW };
            for (const o of L.solids) expect(rectRect(r, o)).toBeNull();
            for (const buoy of L.buoys) expect(rectCircle(r, buoy)).toBeNull();
            expect(s.z).toBeLessThan(SHORE_Z);
          }
        }
  });

  it('shuffles the berths so routes cross, and puts some on the jetty from level 2', () => {
    let crossed = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const L = makeLayout(6, 1, mulberry32(seed));
      crossed += crossings(
        L.starts.map((s) => s.x),
        L.berths.map((b) => b.x),
      );
      expect(L.berths.filter((b) => b.row !== 'quay').length).toBeGreaterThanOrEqual(2);
      expect(L.jettyX).not.toBeNull();
    }
    // 15 pairs each: a good share cross, but it isn't simply mirrored.
    expect(crossed / 10).toBeGreaterThan(4);
    expect(crossed / 10).toBeLessThan(13);
    expect(makeLayout(6, 0, mulberry32(1)).jettyX).toBeNull();
  });

  it('gets harder: tighter berths each level, wind only on the last', () => {
    for (let k = 1; k < LEVELS.length; k++) {
      expect(LEVELS[k].slotW).toBeLessThan(LEVELS[k - 1].slotW);
      expect(LEVELS[k].berthLen).toBeLessThan(LEVELS[k - 1].berthLen);
    }
    expect(makeLayout(4, 0, mulberry32(3)).wind).toEqual({ x: 0, z: 0 });
    expect(makeLayout(4, 1, mulberry32(3)).wind).toEqual({ x: 0, z: 0 });
    expect(Math.abs(makeLayout(4, 2, mulberry32(3)).wind.x)).toBeGreaterThan(0);
    // The quay shelters the berths a little.
    expect(windShelter(QUAY_Z + 1)).toBeLessThan(windShelter(0));
  });

  it('plays three levels in order, or the middle one in a tournament', () => {
    expect([1, 2, 3].map((r) => levelFor(r, 3))).toEqual([0, 1, 2]);
    expect(levelFor(1, 1)).toBe(1);
  });

  it('gives a player who left no berth', () => {
    const L = makeLayout(4, 1, mulberry32(2), [false, true, false, false]);
    expect(L.berths[1].z).toBeLessThan(QUAY_Z - 10);
  });
});

describe('handling', () => {
  /** A boat at rest at the left of the harbour, bow to the right: 50 m of open water ahead. */
  function openWater() {
    const sim = new MarinaSim(1, 0, mulberry32(1));
    sim.begin();
    const b = sim.boats[0];
    b.x = -26;
    b.z = 5;
    b.a = Math.PI / 2;
    return { sim, b };
  }

  it('crosses the harbour in about 5–6 s at full throttle, then glides when you let go', () => {
    const { sim, b } = openWater();
    run(sim, 5.5, (s) => s.setStick(0, 0, -1));
    const top = speed(b);
    expect(top).toBeGreaterThan(4.6);
    expect(top).toBeLessThan(6.2);
    expect(b.x + 26).toBeGreaterThan(18);
    run(sim, 1, (s) => s.setStick(0, 0, 0));
    // Still moving a good while later: it has mass.
    expect(speed(b)).toBeGreaterThan(top * 0.5);
  });

  it('stops dead with reverse, much faster than gliding', () => {
    const glide = openWater();
    glide.b.vx = 4.5;
    const rev = openWater();
    rev.b.vx = 4.5;
    let tg = 0;
    let tr = 0;
    while (speed(glide.b) > 0.3 && tg < 20) {
      glide.sim.setStick(0, 0, 0);
      glide.sim.step();
      tg += DT;
    }
    while (surge(rev.b) > 0.3 && tr < 20) {
      rev.sim.setStick(0, 0, 1);
      rev.sim.step();
      tr += DT;
    }
    expect(tr).toBeLessThan(2);
    expect(tg).toBeGreaterThan(tr * 2.5);
  });

  it('steers well at speed, hardly at all when drifting, and a burst of throttle swings it round', () => {
    const fast = openWater();
    fast.b.vx = 4;
    const a0 = fast.b.a;
    run(fast.sim, 1, (s) => s.setStick(0, 1, -0.5));
    const fastTurn = Math.abs(fast.b.a - a0);

    const drift = openWater();
    drift.b.vx = 0.4;
    run(drift.sim, 1, (s) => s.setStick(0, 1, 0));
    const driftTurn = Math.abs(drift.b.a - a0);

    const wash = openWater();
    run(wash.sim, 1, (s) => s.setStick(0, 1, -1));
    const washTurn = Math.abs(wash.b.a - a0);

    expect(fastTurn).toBeGreaterThan(0.45);
    expect(driftTurn).toBeLessThan(0.12);
    expect(washTurn).toBeGreaterThan(driftTurn * 4);
  });

  it('turns to starboard with right rudder going ahead, and the other way going astern (and weaker)', () => {
    const ahead = openWater();
    ahead.b.vx = 2;
    run(ahead.sim, 0.5, (s) => s.setStick(0, 1, 0));
    expect(ahead.b.w).toBeLessThan(0);
    const astern = openWater();
    astern.b.vx = -2;
    run(astern.sim, 0.5, (s) => s.setStick(0, 1, 0));
    expect(astern.b.w).toBeGreaterThan(0);
    expect(Math.abs(astern.b.w)).toBeLessThan(Math.abs(ahead.b.w));
  });

  it('carries a turn on a little after the stick is centred (angular inertia)', () => {
    const { sim, b } = openWater();
    b.vx = 4;
    run(sim, 1, (s) => s.setStick(0, 1, -0.5));
    const a1 = b.a;
    run(sim, 0.4, (s) => s.setStick(0, 0, -0.5));
    expect(Math.abs(b.a - a1)).toBeGreaterThan(0.08);
    run(sim, 2, (s) => s.setStick(0, 0, -0.5));
    expect(Math.abs(b.w)).toBeLessThan(0.05);
  });

  it('carves: in a hard turn the boat slides a little but mostly follows its bow', () => {
    const { sim, b } = openWater();
    b.vx = 5;
    let maxSlip = 0;
    run(sim, 1.5, (s) => {
      s.setStick(0, 1, -1);
      const f = fwd(b.a);
      const sp = speed(b);
      if (sp > 1) maxSlip = Math.max(maxSlip, Math.acos(Math.min(1, (b.vx * f.x + b.vz * f.z) / sp)));
    });
    expect(maxSlip).toBeGreaterThan(0.02);
    expect(maxSlip).toBeLessThan(0.5);
    expect(speed(b)).toBeGreaterThan(3);
  });

  it('nothing moves before "go"', () => {
    const sim = new MarinaSim(2, 0, mulberry32(1));
    sim.setStick(0, 1, -1);
    expect(sim.step()).toEqual([]);
    expect(speed(sim.boats[0])).toBe(0);
  });
});

describe('collisions', () => {
  it('never tunnels through a finger or the jetty, whatever the angle', () => {
    let tried = 0;
    for (let level = 0; level < 3; level++) {
      const sim = new MarinaSim(1, level, mulberry32(5));
      sim.begin();
      const thin = sim.layout.solids.filter((s) => s.kind === 'finger' || s.kind === 'jetty');
      for (const s of thin)
        for (let k = 0; k < 8; k++) {
          const b = sim.boats[0];
          // Start 3 m to one side of the pontoon, aimed straight at it at top speed (and faster).
          const side = stbd(s.a);
          const sgn = k % 2 ? 1 : -1;
          b.x = s.x + side.x * sgn * (s.hw + 3);
          b.z = s.z + side.z * sgn * (s.hw + 3);
          const toward = Math.atan2(-side.x * sgn, -side.z * sgn) + (k - 4) * 0.12;
          b.a = toward;
          b.vx = fwd(toward).x * TUNING.maxSpeed;
          b.vz = fwd(toward).z * TUNING.maxSpeed;
          b.w = 0;
          // Only from open water (not from inside a neighbouring moored boat).
          if (sim.layout.solids.some((o) => rectRect(b, o))) continue;
          tried++;
          const before = (b.x - s.x) * side.x + (b.z - s.z) * side.z;
          for (let n = 0; n < 60; n++) {
            sim.setStick(0, 0, -1);
            sim.step();
          }
          const after = (b.x - s.x) * side.x + (b.z - s.z) * side.z;
          expect(Math.sign(after)).toBe(Math.sign(before));
          expect(rectRect(b, s)?.depth ?? 0).toBeLessThan(0.02);
        }
    }
    expect(tried).toBeGreaterThan(40);
  });

  it('bounces off softly with a thunk, loses speed and counts a hard bump', () => {
    const sim = new MarinaSim(1, 0, mulberry32(1));
    sim.begin();
    const b = sim.boats[0];
    b.x = 0;
    b.z = 0;
    b.a = -Math.PI / 2;
    b.vx = -5;
    // A wall of the harbour is far away; use the left one.
    b.x = -HALF_W + 4;
    const ev = run(sim, 1.5);
    const bump = ev.find((e) => e.t === 'bump');
    expect(bump).toBeTruthy();
    expect(bump && bump.t === 'bump' && bump.hard).toBe(true);
    expect(b.vx).toBeGreaterThan(0);
    expect(speed(b)).toBeLessThan(2.5);
    expect(b.bumps).toBe(1);
    expect(b.touches).toBe(1);
  });

  it('a gentle touch costs the clean bonus but no point', () => {
    const sim = new MarinaSim(1, 0, mulberry32(1));
    sim.begin();
    const b = sim.boats[0];
    b.x = -HALF_W + 2.4;
    b.z = 0;
    b.a = -Math.PI / 2;
    b.vx = -1.1;
    run(sim, 3);
    expect(b.touches).toBe(1);
    expect(b.bumps).toBe(0);
  });

  it('boats push each other apart, and the one that rams is to blame', () => {
    const sim = new MarinaSim(2, 0, mulberry32(1));
    sim.begin();
    const [A, B] = sim.boats;
    A.x = 0;
    A.z = 4;
    A.a = Math.PI / 2;
    A.vx = 0;
    B.x = -5;
    B.z = 4;
    B.a = Math.PI / 2;
    B.vx = BUMP_V + 2;
    const ev = run(sim, 2);
    expect(rectRect(A, B)).toBeNull();
    expect(A.x).toBeGreaterThan(1);
    const bump = ev.find((e) => e.t === 'bump');
    expect(bump && bump.t === 'bump' && bump.i).toBe(1);
    expect(B.bumps).toBe(1);
    expect(A.bumps).toBe(0);
    expect(A.touches).toBe(0);
  });

  it('two boats head on at full speed never pass through each other', () => {
    const sim = new MarinaSim(2, 0, mulberry32(1));
    sim.begin();
    const [A, B] = sim.boats;
    A.x = -6;
    A.z = 0;
    A.a = Math.PI / 2;
    A.vx = TUNING.maxSpeed;
    B.x = 6;
    B.z = 0.3;
    B.a = -Math.PI / 2;
    B.vx = -TUNING.maxSpeed;
    run(sim, 3, (s) => {
      s.setStick(0, 0, -1);
      s.setStick(1, 0, -1);
    });
    expect(A.x).toBeLessThan(B.x);
    expect(rectRect(A, B)?.depth ?? 0).toBeLessThan(0.02);
  });

  it('a moored (parked) boat is a solid obstacle', () => {
    const sim = new MarinaSim(2, 0, mulberry32(1));
    sim.begin();
    parkInPlace(sim, 0);
    run(sim, DOCK_HOLD + 0.1);
    expect(sim.boats[0].docked).toBe(true);
    const A = sim.boats[0];
    const x0 = A.x;
    const B = sim.boats[1];
    const f = fwd(A.a);
    B.a = A.a;
    B.x = A.x - f.x * 6;
    B.z = A.z - f.z * 6;
    B.vx = f.x * 4;
    B.vz = f.z * 4;
    run(sim, 2);
    expect(A.x).toBe(x0);
    expect(rectRect(A, B)).toBeNull();
    expect(B.bumps).toBe(1);
  });
});

describe('docking', () => {
  it('parks after holding still inside the lines for DOCK_HOLD, not before', () => {
    const sim = new MarinaSim(2, 0, mulberry32(1));
    sim.begin();
    parkInPlace(sim, 0);
    run(sim, DOCK_HOLD - 0.1);
    expect(sim.boats[0].docked).toBe(false);
    expect(sim.boats[0].hold).toBeGreaterThan(0.5);
    const ev = run(sim, 0.15);
    expect(sim.boats[0].docked).toBe(true);
    expect(sim.boats[0].place).toBe(1);
    expect(ev).toContainEqual({ t: 'dock', i: 0, place: 1 });
    expect(parkQuality(sim.boats[0], sim.layout.berths[0]).centre).toBeCloseTo(1);
  });

  it('does not count with the stern over the line', () => {
    const sim = new MarinaSim(1, 1, mulberry32(1));
    sim.begin();
    const B = sim.layout.berths[0];
    parkInPlace(sim, 0);
    // Out past the painted end of the berth (where the fingers stop), by 10 cm.
    const b = sim.boats[0];
    const f = fwd(B.a);
    b.x -= f.x * (B.hl - BOAT_HL + 0.1);
    b.z -= f.z * (B.hl - BOAT_HL + 0.1);
    run(sim, 2);
    expect(sim.boats[0].inLines).toBe(false);
    expect(sim.boats[0].docked).toBe(false);
  });

  it('does not count crooked across the berth', () => {
    const sim = new MarinaSim(1, 2, mulberry32(1));
    sim.begin();
    parkInPlace(sim, 0, 0, 0.5);
    run(sim, 2);
    expect(sim.boats[0].docked).toBe(false);
  });

  it('does not count while still moving through the box', () => {
    const sim = new MarinaSim(1, 0, mulberry32(1));
    sim.begin();
    const b = sim.boats[0];
    const B = sim.layout.berths[0];
    parkInPlace(sim, 0);
    // Drift slowly along the berth, just too fast, for longer than the hold.
    const f = fwd(B.a);
    const s0 = { x: b.x - f.x * 0.6, z: b.z - f.z * 0.6 };
    b.x = s0.x;
    b.z = s0.z;
    let held = 0;
    run(sim, 1.2, () => {
      b.vx = f.x * (DOCK_SPEED + 0.1);
      b.vz = f.z * (DOCK_SPEED + 0.1);
      held = Math.max(held, b.hold);
    });
    expect(b.docked).toBe(false);
    expect(held).toBe(0);
  });

  it('slipping out eats into the hold quickly; a blip at the threshold does not wipe it', () => {
    const sim = new MarinaSim(1, 0, mulberry32(1));
    sim.begin();
    parkInPlace(sim, 0);
    run(sim, DOCK_HOLD * 0.6);
    const b = sim.boats[0];
    const h0 = b.hold;
    expect(h0).toBeGreaterThan(0);
    // A shove: the hold drains at HOLD_DECAY× and is gone well before you could have parked.
    b.vz += 1;
    sim.step();
    expect(b.hold).toBeCloseTo(h0 - DT * HOLD_DECAY, 5);
    run(sim, 0.5, () => {
      b.vx = 0;
      b.vz = 1;
    });
    expect(b.hold).toBe(0);
    expect(b.docked).toBe(false);
  });

  it('once holding, a little more than DOCK_SPEED still counts (no flicker at the threshold)', () => {
    const sim = new MarinaSim(1, 0, mulberry32(1));
    sim.begin();
    parkInPlace(sim, 0);
    const b = sim.boats[0];
    const B = sim.layout.berths[0];
    const f = fwd(B.a);
    // Back from the middle, creeping towards the pier at just over the start threshold.
    b.x -= f.x * 0.5;
    b.z -= f.z * 0.5;
    sim.step();
    expect(b.hold).toBeGreaterThan(0);
    const v = DOCK_SPEED * 1.2;
    run(sim, DOCK_HOLD, () => {
      b.vx = f.x * v;
      b.vz = f.z * v;
    });
    expect(b.docked).toBe(true);
  });

  it('only your own berth counts', () => {
    const sim = new MarinaSim(2, 0, mulberry32(1));
    sim.begin();
    const b = sim.boats[0];
    const other = sim.layout.berths[1];
    b.x = other.x;
    b.z = other.z;
    b.a = other.a;
    run(sim, 2);
    expect(b.docked).toBe(false);
  });

  it('a parked boat stays put and ignores the stick', () => {
    const sim = new MarinaSim(2, 0, mulberry32(1));
    sim.begin();
    parkInPlace(sim, 0);
    run(sim, DOCK_HOLD + 0.05);
    const b = sim.boats[0];
    const at = { x: b.x, z: b.z };
    run(sim, 1, (s) => s.setStick(0, 1, -1));
    expect({ x: b.x, z: b.z }).toEqual(at);
  });
});

describe('scoring', () => {
  it('first to park scores most, then one after another', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(placePoints)).toEqual(PLACE_POINTS);
    for (let k = 1; k < PLACE_POINTS.length; k++) expect(PLACE_POINTS[k]).toBeLessThan(PLACE_POINTS[k - 1]);
    expect(placePoints(9)).toBe(1);
    expect(placePoints(0)).toBe(0);
  });

  it('adds bonuses for centred, straight and clean, and takes a point per hard bump (capped)', () => {
    const base = { docked: true, place: 1, solo: false, dockTime: 20, centre: 1, straight: 1, touches: 0, bumps: 0, dist: 0 };
    const best = roundScore(base);
    expect(best).toMatchObject({ order: 10, centre: 2, straight: 2, clean: CLEAN_POINTS, bumps: 0, total: 16 });
    const sloppy = roundScore({ ...base, centre: 0.3, straight: 0.6, touches: 2, bumps: 1 });
    expect(sloppy).toMatchObject({ centre: 1, straight: 1, clean: 0, bumps: 1, total: 11 });
    const wrecked = roundScore({ ...base, place: 8, centre: 0, straight: 0, touches: 9, bumps: 9 });
    expect(wrecked.bumps).toBe(MAX_BUMP_PENALTY);
    expect(wrecked.total).toBe(1);
  });

  it('gives a little for getting close when the time runs out', () => {
    expect(nearPoints(2)).toBe(3);
    expect(nearPoints(6)).toBe(2);
    expect(nearPoints(12)).toBe(1);
    expect(nearPoints(30)).toBe(0);
    const s = roundScore({ docked: false, place: 0, solo: false, dockTime: 0, centre: 0, straight: 0, touches: 3, bumps: 1, dist: 3 });
    expect(s).toMatchObject({ docked: false, order: 0, near: 3, total: 2 });
    expect(roundScore({ docked: false, place: 0, solo: false, dockTime: 0, centre: 0, straight: 0, touches: 3, bumps: 3, dist: 20 }).total).toBe(0);
  });

  it('on your own, the time it took counts instead of the order', () => {
    expect(soloTimePoints(10)).toBe(10);
    expect(soloTimePoints(30)).toBe(6);
    expect(soloTimePoints(80)).toBe(2);
    expect(roundScore({ docked: true, place: 1, solo: true, dockTime: 30, centre: 1, straight: 1, touches: 0, bumps: 0, dist: 0 }).order).toBe(6);
  });

  it('rates centred and straight, either way round', () => {
    const berth = { x: 0, z: 0, a: Math.PI, hl: 3, hw: 1.4 };
    expect(parkQuality({ x: 0, z: 0, a: Math.PI, hl: BOAT_HL, hw: BOAT_HW }, berth)).toEqual({ centre: 1, straight: 1 });
    expect(parkQuality({ x: 0, z: 0, a: 0, hl: BOAT_HL, hw: BOAT_HW }, berth).straight).toBeCloseTo(1);
    const off = parkQuality({ x: 0.25, z: 0, a: Math.PI - 0.1, hl: BOAT_HL, hw: BOAT_HW }, berth);
    expect(off.centre).toBeCloseTo(0.5);
    expect(off.straight).toBeGreaterThan(0.4);
    expect(off.straight).toBeLessThan(0.7);
  });

  it('scores a whole round in docking order', () => {
    const sim = new MarinaSim(3, 0, mulberry32(4));
    sim.begin();
    parkInPlace(sim, 2);
    run(sim, 0.5);
    parkInPlace(sim, 0, 0.2);
    run(sim, 2);
    expect(sim.boats[2].place).toBe(1);
    expect(sim.boats[0].place).toBe(2);
    const r = sim.results();
    expect(r[2].order).toBe(PLACE_POINTS[0]);
    expect(r[0].order).toBe(PLACE_POINTS[1]);
    expect(r[2].total).toBeGreaterThan(r[0].total);
    expect(r[1].docked).toBe(false);
  });

  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });
});

describe('round flow', () => {
  it('ends when everybody has parked', () => {
    const sim = new MarinaSim(2, 0, mulberry32(1));
    sim.begin();
    parkInPlace(sim, 0);
    parkInPlace(sim, 1);
    const ev = run(sim, 3);
    expect(sim.over).toBe(true);
    expect(sim.timeout).toBe(false);
    expect(ev.filter((e) => e.t === 'over')).toHaveLength(1);
  });

  it('ends on the clock, cut short once only one boat is still out', () => {
    const sim = new MarinaSim(3, 0, mulberry32(1));
    sim.begin();
    run(sim, 5);
    expect(sim.over).toBe(false);
    parkInPlace(sim, 0);
    parkInPlace(sim, 1);
    let lastAt = -1;
    run(sim, 2, (s) => {
      if (lastAt < 0 && s.lastCalled) lastAt = s.time;
    });
    expect(lastAt).toBeGreaterThan(5);
    expect(sim.limit).toBeCloseTo(lastAt + LAST_BOAT_S, 1);
    run(sim, LAST_BOAT_S + 1);
    expect(sim.over).toBe(true);
    expect(sim.timeout).toBe(true);
    expect(sim.time).toBeLessThan(LEVELS[0].roundS);
  });

  it('runs out after the level’s time if nobody parks', () => {
    const sim = new MarinaSim(2, 2, mulberry32(1));
    sim.begin();
    run(sim, LEVELS[2].roundS + 1);
    expect(sim.over).toBe(true);
    expect(sim.timeout).toBe(true);
    expect(sim.time).toBeCloseTo(LEVELS[2].roundS, 1);
  });

  it('copes with a player leaving mid-round', () => {
    const sim = new MarinaSim(3, 1, mulberry32(1));
    sim.begin();
    run(sim, 1, (s) => s.setStick(1, 0, -1));
    parkInPlace(sim, 0);
    run(sim, DOCK_HOLD + 0.1);
    sim.remove(1);
    expect(sim.boats[1].gone).toBe(true);
    // A boat that left is no obstacle and has nothing to score.
    parkInPlace(sim, 2);
    run(sim, DOCK_HOLD + 0.2);
    expect(sim.over).toBe(true);
    expect(sim.timeout).toBe(false);
    const r = sim.results();
    expect(r[1].total).toBe(0);
    expect(r[0].order).toBe(PLACE_POINTS[0]);
    expect(r[2].order).toBe(PLACE_POINTS[1]);
  });

  it('ends at once when everybody left', () => {
    const sim = new MarinaSim(2, 0, mulberry32(1));
    sim.begin();
    sim.remove(0);
    sim.remove(1);
    sim.step();
    expect(sim.over).toBe(true);
  });

  it('the horn has a cooldown', () => {
    const sim = new MarinaSim(1, 0, mulberry32(1));
    sim.begin();
    expect(sim.horn(0)).toBe(true);
    expect(sim.horn(0)).toBe(false);
    run(sim, 1);
    expect(sim.horn(0)).toBe(true);
  });
});

describe('every berth can be reached (a scripted skipper parks each one)', () => {
  for (let level = 0; level < LEVELS.length; level++)
    it(`level ${level + 1}: ${LEVELS[level].name}`, () => {
      const times: number[] = [];
      for (const n of [1, 4, 8])
        for (let seed = 1; seed <= 4; seed++)
          for (let i = 0; i < n; i++) {
            const sim = new MarinaSim(n, level, mulberry32(seed * 31 + n));
            for (let k = 0; k < n; k++) if (k !== i) sim.remove(k);
            sim.begin();
            const bot = new Autopilot(sim, i);
            run(sim, LEVELS[level].roundS, (s) => {
              const st = bot.stick();
              s.setStick(i, st.x, st.y);
            });
            expect(sim.boats[i].docked, `n=${n} seed=${seed} boat ${i}`).toBe(true);
            times.push(sim.boats[i].dockTime);
          }
      times.sort((a, b) => a - b);
      // A careful skipper takes 12–30 s; none needs anywhere near the whole clock.
      expect(times[Math.floor(times.length / 2)]).toBeLessThan(25);
      expect(times[times.length - 1]).toBeLessThan(LEVELS[level].roundS - 15);
    });

  it('several skippers at once mostly manage it, giving way to each other', () => {
    let docked = 0;
    let total = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const sim = new MarinaSim(4, 0, mulberry32(seed));
      sim.begin();
      const bots = sim.boats.map((_, i) => new Autopilot(sim, i));
      run(sim, LEVELS[0].roundS, (s) =>
        bots.forEach((b, i) => {
          const st = b.stick();
          s.setStick(i, st.x, st.y);
        }),
      );
      docked += sim.dockedCount;
      total += 4;
    }
    expect(docked / total).toBeGreaterThan(0.75);
  });
});

describe('howTo', () => {
  it('has three short lines', () => {
    expect(howTo(false)).toHaveLength(3);
    expect(howTo(true)[2]).toMatch(/One/);
  });
});
